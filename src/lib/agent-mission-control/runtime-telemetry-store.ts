/**
 * Agent Mission Control — runtime telemetry event persistence (server only).
 *
 * Stores opt-in, best-effort lifecycle pings (`started`/`completed`/`failed`)
 * emitted by generated agent handlers via POST /api/runtime-telemetry into
 * `runtime_telemetry_events` (migration 0017_runtime_telemetry.sql). No
 * sensitive data ever lands here — redacted shapes only, `error` carries a
 * hashed/sanitized summary, never raw prompts, secrets, or stack traces.
 *
 * FAIL-SOFT BY DESIGN: telemetry is a nice-to-have signal, never a dependency
 * the rest of the app can break on. `insertRuntimeTelemetryEvent` never
 * throws — a PostgREST error (down backend, timeout, bad row) is logged
 * server-side and swallowed so a deployed agent's handler keeps working even
 * when Aigent itself is unreachable. Reads (`summarizeRuntimeTelemetry`,
 * `listRecentRuntimeTelemetryEvents`, `summarizeFleetRuntimeTelemetry`) DO
 * throw on a hard PostgREST error — callers
 * (improvement-loop.ts) wrap them in their own fail-soft try/catch, same
 * pattern as the LangSmith/LangGraph observability edges.
 *
 * Never import from a client component (reads the service-role key).
 */
import 'server-only'

import { computeCostUsd } from './model-pricing'
import { pgrest } from './postgrest'
import type { ModelProvider } from './types'

type RawRow = Record<string, unknown>

/**
 * Telemetry events are emitted by generated agent handlers and carry their
 * OWN provider vocabulary (route.ts `providerEnum`: openai/gemini/custom/
 * unknown) — NOT the internal `ModelProvider` union (openai/google/mistral/
 * local) that `computeCostUsd` expects. `gemini` !== `google`: a naive pass-
 * through silently produced zero/garbage cost for every Gemini-backed agent.
 *
 * This is an EXPLICIT, narrow mapping — no guessing. `custom`/`unknown` (and
 * anything unrecognized) have no knowable backing provider, so they map to
 * `null` and MUST NOT be priced. A cost of `0` would be a lie (doctrine:
 * unavailable data is `null`, never `0`).
 *
 * NORMALIZATION NOW HAPPENS AT INGESTION (POST /api/runtime-telemetry writes
 * the already-normalized provider into the row). Keeping this function on the
 * read path is BACKWARD COMPATIBILITY for rows persisted BEFORE that change —
 * which still carry the raw wire vocabulary (`gemini`). It is not a second
 * source of truth: for any row written from now on it is the identity
 * (`openai` -> `openai`, `google` -> `google`) and costs nothing.
 */
export function normalizeTelemetryProviderToModelProvider(provider: string | null | undefined): ModelProvider | null {
  switch (provider) {
    case 'openai':
      return 'openai'
    // Already-normalized values (rows written at/after ingestion normalization).
    case 'google':
      return 'google'
    case 'local':
      return 'local'
    // Legacy wire vocabulary (rows written before ingestion normalization).
    case 'gemini':
      return 'google'
    default:
      // 'custom' | 'unknown' | anything else unrecognized: not mappable.
      return null
  }
}

const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`

export type RuntimeTelemetryStatus = 'started' | 'completed' | 'failed'

/**
 * One lifecycle ping from a deployed agent handler. Mirrors
 * runtime_telemetry_events (migration 0017) column-for-column; `errorHash`
 * is a short SHA-256 of the error message ONLY — never the raw message.
 */
export interface RuntimeTelemetryEvent {
  id: string
  projectId: string
  agentId: string
  agentVersion: string | null
  targetRepo: string | null
  runId: string
  provider: string | null
  model: string | null
  status: RuntimeTelemetryStatus
  latencyMs: number | null
  inputShape: Record<string, unknown>
  outputShape: Record<string, unknown>
  error: { category?: string; messageHash?: string } | Record<string, unknown>
  usage: { totalTokens?: number; promptTokens?: number; completionTokens?: number } | Record<string, unknown>
  environment: Record<string, unknown>
  receivedAt: string
}

/** One error category rollup entry (`summarizeRuntimeTelemetry`). */
export interface RuntimeTelemetryErrorCategory {
  category: string
  count: number
}

/**
 * Explicit measurement state for a scalar that may be structurally
 * unmeasurable — NOT the same as a measured zero.
 *
 * DOCTRINE (the whole point of this file): the reference emitter shipped to
 * delivered agents (consumer-bootstrap.ts `renderTelemetryClient`) sends ONLY
 * { eventId, projectId, agentId, runId, timestamp, status, latencyMs?, model?,
 * provider?, error.messageHash? }. It NEVER sends `usage` (tokens), never sends
 * `error.category`, never sends `outputShape.hasToolCalls`/`toolCallCount`. So
 * for real production traffic those measures are structurally absent, not zero.
 *
 * - MEASURED     : at least one row in the window carried this signal; the
 *                  accompanying value is a real aggregate over those rows.
 * - UNAVAILABLE  : the wire payloads in this window never carried the signal
 *                  (the emitter does not emit it). Value MUST be null — a `0`
 *                  here would be a fabricated measurement.
 * - NOT_APPLICABLE: there were no rows at all to measure over (empty window).
 */
export type TelemetryMeasurementState = 'MEASURED' | 'UNAVAILABLE' | 'NOT_APPLICABLE'

/**
 * Per-measure provenance for the fields the reference emitter never populates.
 * A consumer reads these to render "—" / "not reported" instead of a
 * fabricated 0, and to tell "measured zero" apart from "never measured".
 */
export interface TelemetryMeasurementProvenance {
  /** Tokens (`usage.totalTokens`). UNAVAILABLE for reference-emitter traffic. */
  tokens: TelemetryMeasurementState
  /** USD cost (needs mappable provider + model + input/output token SPLIT). UNAVAILABLE for reference-emitter traffic. */
  cost: TelemetryMeasurementState
  /**
   * Error categories. MEASURED only when at least one failed row carried a
   * real `error.category`; UNAVAILABLE when failures exist but none was
   * categorized (the reference emitter sends only `messageHash`), and
   * NOT_APPLICABLE when there were no failures at all.
   */
  errorCategories: TelemetryMeasurementState
  /** Tool-call execution signal (`outputShape.hasToolCalls`/`toolCallCount`). UNAVAILABLE for reference-emitter traffic. */
  toolSignals: TelemetryMeasurementState
}

/**
 * Tool-execution signal rollup — exposes the "healthy catalogue vs. executed
 * without tools" distinction at the telemetry layer.
 *
 * The AGENTS.md LangGraph trap: a copilot can look healthy (runs complete,
 * success rate high) while every run reached the model with `tool_call_count=0`
 * — i.e. it ran against the bare graph with none of its tools mounted, and
 * answered "no data" without ever calling one. That is invisible in a plain
 * success-rate. When the emitter reports `outputShape.toolCallCount`, we can
 * surface it: many completed runs with zero tool calls is a red flag, not
 * health.
 *
 * `null` counts mean the signal was never reported (see `state`), never zero.
 */
export interface RuntimeTelemetryToolSignals {
  /** Provenance for the whole block. UNAVAILABLE ⇒ every count below is null. */
  state: TelemetryMeasurementState
  /** Completed runs whose payload carried a tool-call signal (hasToolCalls or toolCallCount present). */
  runsWithToolSignal: number | null
  /** Of those, runs that executed WITHOUT invoking any tool (toolCallCount === 0 / hasToolCalls === false). */
  runsExecutedWithoutTools: number | null
  /** Of those, runs that invoked at least one tool. */
  runsInvokedTools: number | null
}

/** Aggregate runtime-health summary for a project+agent pair. */
export interface RuntimeTelemetrySummary {
  totalRuns: number
  /**
   * REAL counts, tallied from terminal-status rows — NOT reconstructed from
   * `successRate * totalRuns`. A consumer showing "N completed · M failed"
   * MUST read these, never multiply a float rate by a denominator that
   * includes non-terminal `started` pings (which would fabricate the split).
   * `startedRuns` is the count of runs seen only in-flight (no terminal row in
   * the window); `completedRuns + failedRuns` is the terminal denominator
   * behind `successRate`.
   */
  completedRuns: number
  failedRuns: number
  startedRuns: number
  successRate: number | null
  failureRate: number | null
  avgLatencyMs: number | null
  p95LatencyMs: number | null
  totalTokens: number | null
  /**
   * Sum of USD cost across rows where provider+model+split token counts were
   * all knowable and mappable to a `ModelProvider`. `null` — never `0` — when
   * no row in the window had enough information to price (see doctrine note
   * on `normalizeTelemetryProviderToModelProvider`).
   */
  totalCostUsd: number | null
  /**
   * True whenever `totalCostUsd` is non-null: `computeCostUsd` prices are
   * conservative estimates, never billing-grade truth (see model-pricing.ts
   * header). Mirrors that file's per-row `estimated` flag at the aggregate
   * level so a caller never presents this figure as an exact invoice.
   */
  costEstimated: boolean
  topErrorCategories: RuntimeTelemetryErrorCategory[]
  /**
   * Per-measure provenance for tokens / cost / error categories / tool
   * signals — lets a consumer distinguish "measured zero" from "the emitter
   * never reported it" (see TelemetryMeasurementProvenance).
   */
  measurement: TelemetryMeasurementProvenance
  /** Tool-execution signal (catalogue-healthy vs. executed-without-tools). */
  toolSignals: RuntimeTelemetryToolSignals
  lastSeenAt: string | null
}

function rowToEvent(r: RawRow): RuntimeTelemetryEvent {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    agentId: r.agent_id as string,
    agentVersion: (r.agent_version as string | null) ?? null,
    targetRepo: (r.target_repo as string | null) ?? null,
    runId: r.run_id as string,
    provider: (r.provider as string | null) ?? null,
    model: (r.model as string | null) ?? null,
    status: r.status as RuntimeTelemetryStatus,
    latencyMs: (r.latency_ms as number | null) ?? null,
    inputShape: (r.input_shape as Record<string, unknown>) ?? {},
    outputShape: (r.output_shape as Record<string, unknown>) ?? {},
    error: (r.error as Record<string, unknown>) ?? {},
    usage: (r.usage as Record<string, unknown>) ?? {},
    environment: (r.environment as Record<string, unknown>) ?? {},
    receivedAt: r.received_at as string,
  }
}

/**
 * Persist one telemetry event. FAIL-SOFT: catches every error, logs it
 * server-side, and never rethrows — the route that calls this must stay
 * fire-and-forget (202 accepted) regardless of PostgREST's health.
 */
export async function insertRuntimeTelemetryEvent(event: RuntimeTelemetryEvent): Promise<void> {
  try {
    await pgrest('POST', 'runtime_telemetry_events', {
      id: event.id,
      project_id: event.projectId,
      agent_id: event.agentId,
      agent_version: event.agentVersion,
      target_repo: event.targetRepo,
      run_id: event.runId,
      provider: event.provider,
      model: event.model,
      status: event.status,
      latency_ms: event.latencyMs,
      input_shape: event.inputShape,
      output_shape: event.outputShape,
      error: event.error,
      usage: event.usage,
      environment: event.environment,
      received_at: event.receivedAt,
    })
  } catch (err) {
    console.error('[runtime-telemetry-store] insert failed', err instanceof Error ? err.message : err)
  }
}

function percentile95(sortedAsc: number[]): number {
  if (sortedAsc.length === 0) return 0
  const idx = Math.min(sortedAsc.length - 1, Math.ceil(sortedAsc.length * 0.95) - 1)
  return sortedAsc[Math.max(0, idx)]
}

/** Rollup fields shared by every aggregation grain (single agent, fleet-wide, per-agent-in-fleet). */
interface TelemetryRollup {
  totalRuns: number
  completedRuns: number
  failedRuns: number
  startedRuns: number
  successRate: number | null
  avgLatencyMs: number | null
  p95LatencyMs: number | null
  totalTokens: number | null
  totalCostUsd: number | null
  costEstimated: boolean
  topErrorCategories: RuntimeTelemetryErrorCategory[]
  measurement: TelemetryMeasurementProvenance
  toolSignals: RuntimeTelemetryToolSignals
  lastSeenAt: string | null
}

/**
 * Reduce a batch of raw telemetry rows into one rollup. The single shared
 * implementation behind summarizeRuntimeTelemetry/summarizeFleetRuntimeTelemetry
 * — same rules (terminal-status success rate, p95 over real latencies only,
 * top-5 error categories) computed once instead of copy-pasted per grain.
 */
function reduceTelemetryRows(rows: RawRow[]): TelemetryRollup {
  if (rows.length === 0) {
    return {
      totalRuns: 0,
      completedRuns: 0,
      failedRuns: 0,
      startedRuns: 0,
      successRate: null,
      avgLatencyMs: null,
      p95LatencyMs: null,
      totalTokens: null,
      totalCostUsd: null,
      costEstimated: false,
      topErrorCategories: [],
      measurement: {
        tokens: 'NOT_APPLICABLE',
        cost: 'NOT_APPLICABLE',
        errorCategories: 'NOT_APPLICABLE',
        toolSignals: 'NOT_APPLICABLE',
      },
      toolSignals: {
        state: 'NOT_APPLICABLE',
        runsWithToolSignal: null,
        runsExecutedWithoutTools: null,
        runsInvokedTools: null,
      },
      lastSeenAt: null,
    }
  }

  let completed = 0
  let failed = 0
  let started = 0
  let tokenSum = 0
  let hasTokens = false
  let costSum = 0
  let hasCost = false
  const latencies: number[] = []
  const errorCounts = new Map<string, number>()
  // Error-category provenance: did ANY failed row carry a real category, or
  // are we only ever seeing the reference emitter (messageHash, no category)?
  let hasCategorizedError = false
  // Tool-execution signal, only counted from rows whose payload actually
  // reported it (`outputShape.hasToolCalls`/`toolCallCount`).
  let toolSignalRuns = 0
  let toolSignalWithoutTools = 0
  let toolSignalInvoked = 0
  let lastSeenAt: string | null = null

  for (const r of rows) {
    const status = r.status as RuntimeTelemetryStatus
    if (status === 'completed') completed += 1
    else if (status === 'failed') failed += 1
    else if (status === 'started') started += 1

    const latency = r.latency_ms as number | null
    if (typeof latency === 'number' && Number.isFinite(latency)) latencies.push(latency)

    const usage = (r.usage as Record<string, unknown>) ?? {}
    const totalTokens = usage.totalTokens
    if (typeof totalTokens === 'number' && Number.isFinite(totalTokens)) {
      tokenSum += totalTokens
      hasTokens = true
    }

    // Cost is only computable when we know: a mappable provider, a model id,
    // and the input/output token SPLIT (input and output are priced
    // differently — `totalTokens` alone can't be priced accurately). Any gap
    // means this row contributes nothing to the sum — never a guessed 0.
    const mappedProvider = normalizeTelemetryProviderToModelProvider(r.provider as string | null)
    const model = r.model as string | null
    const inputTokens = usage.inputTokens
    const outputTokens = usage.outputTokens
    if (
      mappedProvider &&
      typeof model === 'string' &&
      model.length > 0 &&
      typeof inputTokens === 'number' &&
      Number.isFinite(inputTokens) &&
      typeof outputTokens === 'number' &&
      Number.isFinite(outputTokens)
    ) {
      costSum += computeCostUsd(mappedProvider, model, inputTokens, outputTokens)
      hasCost = true
    }

    if (status === 'failed') {
      const errorField = (r.error as Record<string, unknown>) ?? {}
      // Count ONLY real categories. The reference emitter sends error.messageHash
      // with NO category, so bucketing those as 'uncategorized' would fabricate a
      // measured category out of a structural absence. A failure with no category
      // signal is recorded as UNAVAILABLE provenance below, not as a phantom row.
      if (typeof errorField.category === 'string' && errorField.category.trim().length > 0) {
        const category = errorField.category
        errorCounts.set(category, (errorCounts.get(category) ?? 0) + 1)
        hasCategorizedError = true
      }
    }

    // Tool-execution signal — read only from rows whose payload actually
    // reported it. `outputShape.hasToolCalls` (bool) and/or
    // `outputShape.toolCallCount` (number) are what the wire schema allows;
    // the reference emitter sends neither, so this stays UNAVAILABLE for
    // reference-emitter traffic instead of counting a phantom "0 tools".
    {
      const outputShape = (r.output_shape as Record<string, unknown>) ?? {}
      const toolCallCount = outputShape.toolCallCount
      const hasToolCalls = outputShape.hasToolCalls
      const countReported = typeof toolCallCount === 'number' && Number.isFinite(toolCallCount)
      const boolReported = typeof hasToolCalls === 'boolean'
      if (countReported || boolReported) {
        toolSignalRuns += 1
        // Prefer the explicit count; fall back to the boolean when only it exists.
        const invokedTools = countReported ? (toolCallCount as number) > 0 : (hasToolCalls as boolean)
        if (invokedTools) toolSignalInvoked += 1
        else toolSignalWithoutTools += 1
      }
    }

    const receivedAt = r.received_at as string | undefined
    if (receivedAt && (!lastSeenAt || receivedAt > lastSeenAt)) lastSeenAt = receivedAt
  }

  const sortedLatencies = [...latencies].sort((a, b) => a - b)
  const avgLatencyMs =
    latencies.length > 0 ? Math.round(latencies.reduce((sum, v) => sum + v, 0) / latencies.length) : null
  const p95LatencyMs = latencies.length > 0 ? Math.round(percentile95(sortedLatencies)) : null

  // Success rate over runs that reached a terminal status — 'started' pings
  // alone don't count against it.
  const terminalRuns = completed + failed
  const successRate = terminalRuns > 0 ? completed / terminalRuns : null

  const topErrorCategories: RuntimeTelemetryErrorCategory[] = [...errorCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  // Error-category provenance:
  //  - MEASURED       : at least one failure carried a real category.
  //  - UNAVAILABLE    : failures occurred but none was categorized (reference
  //                     emitter sends only messageHash) — a real signal gap,
  //                     NOT "no failures".
  //  - NOT_APPLICABLE : no failed rows at all in the window.
  const errorCategoriesState: TelemetryMeasurementState = hasCategorizedError
    ? 'MEASURED'
    : failed > 0
      ? 'UNAVAILABLE'
      : 'NOT_APPLICABLE'

  const toolSignalsState: TelemetryMeasurementState = toolSignalRuns > 0 ? 'MEASURED' : 'UNAVAILABLE'

  return {
    totalRuns: rows.length,
    completedRuns: completed,
    failedRuns: failed,
    startedRuns: started,
    successRate,
    avgLatencyMs,
    p95LatencyMs,
    totalTokens: hasTokens ? tokenSum : null,
    totalCostUsd: hasCost ? Math.round(costSum * 1e6) / 1e6 : null,
    costEstimated: hasCost,
    topErrorCategories,
    measurement: {
      tokens: hasTokens ? 'MEASURED' : 'UNAVAILABLE',
      cost: hasCost ? 'MEASURED' : 'UNAVAILABLE',
      errorCategories: errorCategoriesState,
      toolSignals: toolSignalsState,
    },
    toolSignals: {
      state: toolSignalsState,
      runsWithToolSignal: toolSignalRuns > 0 ? toolSignalRuns : null,
      runsExecutedWithoutTools: toolSignalRuns > 0 ? toolSignalWithoutTools : null,
      runsInvokedTools: toolSignalRuns > 0 ? toolSignalInvoked : null,
    },
    lastSeenAt,
  }
}

/**
 * Aggregate runtime-health summary for a project+agent pair, computed live
 * from a bounded recent window (last 500 events — enough to be representative
 * without an unbounded scan). Throws on a hard PostgREST error; callers
 * wrap this in their own fail-soft try/catch (see improvement-loop.ts).
 */
export async function summarizeRuntimeTelemetry(projectId: string, agentId: string): Promise<RuntimeTelemetrySummary> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `runtime_telemetry_events?${eq('project_id', projectId)}&${eq('agent_id', agentId)}` +
      `&select=status,latency_ms,usage,error,output_shape,received_at,provider,model&order=received_at.desc&limit=500`
  )
  const rollup = reduceTelemetryRows(rows)
  return {
    ...rollup,
    failureRate: rollup.successRate !== null ? 1 - rollup.successRate : null,
  }
}

/** Per-(project, agent) rollup row for the fleet-wide telemetry page. */
export interface RuntimeTelemetryAgentRollup {
  projectId: string
  agentId: string
  totalRuns: number
  /**
   * REAL terminal counts for this agent — so a fleet-level consumer sums
   * `completedRuns`/`failedRuns` directly instead of reconstructing a split
   * from `successRate * totalRuns` (which fabricates counts by mixing in
   * non-terminal `started` pings). `startedRuns` = in-flight-only runs.
   */
  completedRuns: number
  failedRuns: number
  startedRuns: number
  successRate: number | null
  avgLatencyMs: number | null
  lastSeenAt: string | null
}

/** Fleet-wide runtime-health summary across every project/agent that has reported telemetry. */
export interface RuntimeTelemetryFleetSummary extends TelemetryRollup {
  reportingAgents: number
  byAgent: RuntimeTelemetryAgentRollup[]
}

/** Bounded window of raw events, most recent first — the fleet-wide event feed. Throws on a hard PostgREST error. */
export async function listRecentRuntimeTelemetryEvents(limit = 50): Promise<RuntimeTelemetryEvent[]> {
  const rows = await pgrest<RawRow[]>('GET', `runtime_telemetry_events?select=*&order=received_at.desc&limit=${limit}`)
  return rows.map(rowToEvent)
}

/**
 * Aggregate runtime-health summary across EVERY project/agent, computed live
 * from a bounded recent window (last 2000 events — enough to be representative
 * fleet-wide without an unbounded scan). Throws on a hard PostgREST error;
 * callers wrap this in their own fail-soft try/catch (same pattern as
 * summarizeRuntimeTelemetry / improvement-loop.ts).
 */
export async function summarizeFleetRuntimeTelemetry(): Promise<RuntimeTelemetryFleetSummary> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    'runtime_telemetry_events?select=project_id,agent_id,status,latency_ms,usage,error,output_shape,received_at,provider,model&order=received_at.desc&limit=2000'
  )

  const byProjectAgent = new Map<string, RawRow[]>()
  for (const r of rows) {
    const key = `${r.project_id as string}::${r.agent_id as string}`
    const bucket = byProjectAgent.get(key)
    if (bucket) bucket.push(r)
    else byProjectAgent.set(key, [r])
  }

  const byAgent: RuntimeTelemetryAgentRollup[] = [...byProjectAgent.entries()]
    .map(([key, agentRows]) => {
      const [projectId, agentId] = key.split('::')
      const rollup = reduceTelemetryRows(agentRows)
      return {
        projectId,
        agentId,
        totalRuns: rollup.totalRuns,
        completedRuns: rollup.completedRuns,
        failedRuns: rollup.failedRuns,
        startedRuns: rollup.startedRuns,
        successRate: rollup.successRate,
        avgLatencyMs: rollup.avgLatencyMs,
        lastSeenAt: rollup.lastSeenAt,
      }
    })
    .sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''))

  return {
    ...reduceTelemetryRows(rows),
    reportingAgents: byProjectAgent.size,
    byAgent,
  }
}
