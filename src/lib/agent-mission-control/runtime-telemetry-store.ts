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
 * when Aigent itself is unreachable. Reads (`listRuntimeTelemetryEvents`,
 * `summarizeRuntimeTelemetry`) DO throw on a hard PostgREST error — callers
 * (improvement-loop.ts) wrap them in their own fail-soft try/catch, same
 * pattern as the LangSmith/LangGraph observability edges.
 *
 * Never import from a client component (reads the service-role key).
 */
import 'server-only'

import { pgrest } from './postgrest'

type RawRow = Record<string, unknown>

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

/** Aggregate runtime-health summary for a project+agent pair. */
export interface RuntimeTelemetrySummary {
  totalRuns: number
  successRate: number | null
  failureRate: number | null
  avgLatencyMs: number | null
  p95LatencyMs: number | null
  totalTokens: number | null
  topErrorCategories: RuntimeTelemetryErrorCategory[]
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

/** Recent telemetry events for a project+agent, newest first. Throws on a hard PostgREST error. */
export async function listRuntimeTelemetryEvents(
  projectId: string,
  agentId: string,
  limit = 50
): Promise<RuntimeTelemetryEvent[]> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `runtime_telemetry_events?${eq('project_id', projectId)}&${eq('agent_id', agentId)}&select=*&order=received_at.desc&limit=${limit}`
  )
  return rows.map(rowToEvent)
}

function percentile95(sortedAsc: number[]): number {
  if (sortedAsc.length === 0) return 0
  const idx = Math.min(sortedAsc.length - 1, Math.ceil(sortedAsc.length * 0.95) - 1)
  return sortedAsc[Math.max(0, idx)]
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
      `&select=status,latency_ms,usage,error,received_at&order=received_at.desc&limit=500`
  )

  if (rows.length === 0) {
    return {
      totalRuns: 0,
      successRate: null,
      failureRate: null,
      avgLatencyMs: null,
      p95LatencyMs: null,
      totalTokens: null,
      topErrorCategories: [],
      lastSeenAt: null,
    }
  }

  const totalRuns = rows.length
  let completed = 0
  let failed = 0
  let tokenSum = 0
  let hasTokens = false
  const latencies: number[] = []
  const errorCounts = new Map<string, number>()
  let lastSeenAt: string | null = null

  for (const r of rows) {
    const status = r.status as RuntimeTelemetryStatus
    if (status === 'completed') completed += 1
    else if (status === 'failed') failed += 1

    const latency = r.latency_ms as number | null
    if (typeof latency === 'number' && Number.isFinite(latency)) latencies.push(latency)

    const usage = (r.usage as Record<string, unknown>) ?? {}
    const totalTokens = usage.totalTokens
    if (typeof totalTokens === 'number' && Number.isFinite(totalTokens)) {
      tokenSum += totalTokens
      hasTokens = true
    }

    if (status === 'failed') {
      const errorField = (r.error as Record<string, unknown>) ?? {}
      const category = typeof errorField.category === 'string' && errorField.category.trim().length > 0 ? errorField.category : 'uncategorized'
      errorCounts.set(category, (errorCounts.get(category) ?? 0) + 1)
    }

    const receivedAt = r.received_at as string | undefined
    if (receivedAt && (!lastSeenAt || receivedAt > lastSeenAt)) lastSeenAt = receivedAt
  }

  const sortedLatencies = [...latencies].sort((a, b) => a - b)
  const avgLatencyMs = latencies.length > 0 ? Math.round(latencies.reduce((sum, v) => sum + v, 0) / latencies.length) : null
  const p95LatencyMs = latencies.length > 0 ? Math.round(percentile95(sortedLatencies)) : null

  // Success/failure rate over the runs that reached a terminal status —
  // 'started' pings alone don't count against either.
  const terminalRuns = completed + failed
  const successRate = terminalRuns > 0 ? completed / terminalRuns : null
  const failureRate = terminalRuns > 0 ? failed / terminalRuns : null

  const topErrorCategories: RuntimeTelemetryErrorCategory[] = [...errorCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return {
    totalRuns,
    successRate,
    failureRate,
    avgLatencyMs,
    p95LatencyMs,
    totalTokens: hasTokens ? tokenSum : null,
    topErrorCategories,
    lastSeenAt,
  }
}
