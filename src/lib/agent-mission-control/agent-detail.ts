import 'server-only'

import { buildLifecycleTrace, type LifecycleTrace } from './agent-lifecycle-trace'
import { getAvailableAgent, type AvailableAgent } from './available-agents'
import { readConsumerActivation, type ConsumerActivationRead } from './consumer-activation'
import {
  getBenchmarkSuitesForCopilot,
  getCopilot,
  getManifestForCopilot,
  getProject,
  getRunsForCopilot,
  getTestSuitesForCopilot,
  getToolsForCopilot,
  getVersionsForCopilot,
} from './data'
import { getLatestDeliveryEvent, type DeliveryEvent } from './delivery-events-store'
import {
  compareImprovementVersions,
  getLatestProposalForCopilot,
  type ImprovementProposal,
  type VersionComparison,
} from './improvement-loop'
import {
  getLatestTelemetryEventForCopilot,
  summarizeRuntimeTelemetry,
  type RuntimeTelemetrySummary,
} from './runtime-telemetry-store'
import { isExecutable } from './runtime-catalogue'
import type {
  AgentManifest,
  AgentRun,
  BenchmarkSuite,
  Copilot,
  CopilotVersion,
  Project,
  TestSuite,
  ToolDefinition,
} from './types'

/**
 * ONE resolver for every agent-detail section (AIGENT-AGENT-PAGES-021).
 *
 * The legacy pages each ran their own queries and each derived their own idea of
 * "is this agent OK". That is how the header could show a green status while the
 * run button 409'd: two answers, no single truth. Every section now reads this.
 *
 * `agent` is the canonical `AvailableAgent` — the same derivation the catalogue,
 * the counters and the run gate use. Executability is NOT recomputed here.
 */

/** Why a run cannot start. Empty ⇒ the agent is launchable right now. */
export type Blocker = { code: string; label: string; detail: string }

export type AgentDetail = {
  copilot: Copilot
  /** Canonical availability. `undefined` when the copilot is absent from the catalogue. */
  agent: AvailableAgent | undefined
  manifest: AgentManifest | undefined
  versions: CopilotVersion[]
  currentVersion: CopilotVersion | undefined
  tools: ToolDefinition[]
  runs: AgentRun[]
  /** Concrete reasons the run gate would refuse. Mirrors the route's 409 body. */
  blockers: Blocker[]
  /** True only when the run route would accept a launch right now. */
  executable: boolean
  metrics: AgentMetrics
  /**
   * The most recent `agent_delivery_events` row for this copilot, or `null`
   * when this agent has never been delivered. A read FAILURE here rejects the
   * `Promise.all` below like every other field in this resolver — the page's
   * own `error.tsx` catches it, so there is no silent "no delivery" reading
   * for a dead table. `null` here means "queried, none found", never "could
   * not read" — a failed read never reaches this type at all.
   */
  delivery: DeliveryEvent | null
  /**
   * Suites this copilot owns. `run/route.ts` and `benchmarks/run/route.ts`
   * both require a `suiteId` the console has no other source for — these
   * lists are what the run/test/benchmark actions pick from. Empty means
   * "no suite generated yet", not "unknown": a failed read rejects the whole
   * `Promise.all` below like every other field on this page.
   */
  testSuites: TestSuite[]
  benchmarkSuites: BenchmarkSuite[]
  /**
   * The most recent `improvement_proposals` row for this copilot, or `null`
   * when none exists yet. Seeds the Improve panel so a page reload shows the
   * real open/decided cycle instead of losing it to client-only state — the
   * panel still re-fetches after each of its own mutations, this is only the
   * initial paint. A read failure here is NOT allowed to fail the whole page
   * (unlike `delivery`): the improvement loop is a control surface, not a
   * fact this page is chiefly reporting, so it fails soft to `null` with the
   * failure logged, same posture as the loop's own observability edges.
   */
  improveProposal: ImprovementProposal | null
  /**
   * V1-vs-V2 comparison for `improveProposal`, present only once a V2 draft
   * exists (`v2VersionId` set). Recomputed live from `test_runs`/
   * `benchmark_runs` (`compareImprovementVersions`) — never persisted, so it
   * cannot drift. Same fail-soft posture as `improveProposal`: a read failure
   * here renders as "no comparison yet", not a broken page.
   */
  improveComparison: VersionComparison | null
  /**
   * The project this copilot delivers into, resolved from the CANONICAL
   * `agent.projectId` (catalogue-validated — same reasoning as the header's
   * `agent?.projectId` guard in `agent-detail-screen.tsx`, not the raw
   * `copilot.projectId` column, which can point at a deleted project row).
   * `undefined` when the agent has no project link, or the linked id no
   * longer resolves to a live row — both read as "no delivery target".
   */
  project: Project | undefined
  /**
   * The governed lifecycle trace (draft → … → V2 draft), each stage carrying
   * its own source. Unlike every other field in this resolver, the telemetry
   * leg is FAIL-SOFT: telemetry is documented as best-effort everywhere else
   * in this codebase (`runtime-telemetry-store.ts` header), so a telemetry
   * outage degrades that one stage to `unknown` (`telemetryLookupFailed`)
   * instead of failing the whole agent-detail page. Delivery, versions and
   * the improvement-loop proposal are NOT fail-soft here — they follow the
   * resolver's normal fail-hard contract, same as every other field above.
   */
  lifecycle: LifecycleTrace
  /**
   * Runtime telemetry reported back from the DEPLOYED agent's own process —
   * distinct from `runs`/`metrics` above, which are Aigent's OWN executed
   * runs. `null` means the read FAILED (PostgREST error/timeout), never that
   * the agent reported nothing; a zero-event agent still gets a real
   * `RuntimeTelemetrySummary` with `totalRuns: 0`. The page must render
   * "Indisponible" only for the `null` case (see AGENTS.md "loop muted" ≠
   * "agent stopped" doctrine — this resolver does not label absence).
   */
  telemetry: RuntimeTelemetrySummary | null
}

/**
 * Windowed metrics. Every field is `number | null`: null means NOT MEASURED and
 * must render as a dash, never as 0. `runs24h = 0` is a real, measured zero —
 * the window was read and held nothing. The two must never collapse.
 */
export type AgentMetrics = {
  runs24h: number
  totalRuns: number
  successRate: number | null
  avgDurationMs: number | null
  cost24hUsd: number | null
  /** Runs in the window whose cost was never recorded — makes cost24h honest. */
  runsWithoutCost: number
  /**
   * Total tool calls summed over runs that actually COMPLETED. `null` (UNKNOWN)
   * only when no completed run exists to measure from — never a fabricated 0.
   * A real `0` here is MEASURED: the agent ran to completion and mounted no
   * tool (the "healthy catalogue / toolless execution" trap). `toolCallCountState`
   * lets the UI render "0 outils appelés" (MEASURED) vs "non mesuré" (UNKNOWN)
   * without re-deriving the rule.
   */
  toolCallCount: number | null
  toolCallCountState: 'MEASURED' | 'UNKNOWN'
  /** Completed runs the tool-call measurement is drawn from (its denominator). */
  completedRuns: number
  lastRun: AgentRun | undefined
}

const DAY_MS = 24 * 60 * 60 * 1000

function computeMetrics(runs: AgentRun[]): AgentMetrics {
  const now = Date.now()
  const recent = runs.filter((r) => {
    const t = Date.parse(r.startedAt ?? '')
    return Number.isFinite(t) && now - t <= DAY_MS
  })

  // Success rate only means something over runs that actually reached a verdict.
  const decided = runs.filter((r) => r.status === 'completed' || r.status === 'failed')
  const successRate =
    decided.length > 0 ? decided.filter((r) => r.status === 'completed').length / decided.length : null

  const durations = runs
    .map((r) => r.latencyMs)
    .filter((d): d is number => typeof d === 'number' && Number.isFinite(d))
  const avgDurationMs =
    durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null

  const costed = recent.filter((r) => typeof r.costUsd === 'number' && Number.isFinite(r.costUsd))
  const cost24hUsd = costed.length > 0 ? costed.reduce((a, r) => a + (r.costUsd ?? 0), 0) : null

  // Tool-call count is only a MEASUREMENT over runs that actually reached
  // completion: an aborted/running/blocked run's `tool_call_count` reflects how
  // far it got, not what the agent needs. With zero completed runs there is
  // nothing to measure ⇒ null (UNKNOWN), never a fabricated 0. With ≥1 completed
  // run the sum is MEASURED — and a genuine 0 (agent completed, mounted no tool:
  // the "healthy catalogue / toolless execution" trap) is preserved as 0, not
  // collapsed into "no data".
  const completed = runs.filter((r) => r.status === 'completed')
  const toolCallCount =
    completed.length > 0 ? completed.reduce((a, r) => a + (r.toolCallCount ?? 0), 0) : null
  const toolCallCountState: AgentMetrics['toolCallCountState'] =
    toolCallCount === null ? 'UNKNOWN' : 'MEASURED'

  return {
    runs24h: recent.length,
    totalRuns: runs.length,
    successRate,
    avgDurationMs,
    cost24hUsd,
    runsWithoutCost: recent.length - costed.length,
    toolCallCount,
    toolCallCountState,
    completedRuns: completed.length,
    lastRun: runs[0],
  }
}

/**
 * Blockers mirror the run route's own refusal logic, so the page can never
 * promise a launch the API would reject. Order is worst-first.
 */
function computeBlockers(agent: AvailableAgent | undefined, toolsById: Map<string, ToolDefinition>): Blocker[] {
  if (agent === undefined) {
    return [
      {
        code: 'not-in-catalogue',
        label: 'Not in the runtime catalogue',
        detail: 'No canonical agent row resolves for this copilot, so a run cannot be started.',
      },
    ]
  }

  const blockers: Blocker[] = []

  if (agent.status !== 'active') {
    const detail =
      agent.status === 'degraded'
        ? 'The agent declares tools the runner cannot execute.'
        : agent.status === 'unavailable'
          ? 'A hard requirement is missing, or the agent has been retired.'
          : 'The agent is configured but has not been activated. Activation requires a proven run.'
    blockers.push({
      code: 'status',
      label: `Status is ${agent.status}, not active`,
      detail,
    })
  }

  if (agent.unresolvedToolIds.length > 0) {
    const names = agent.unresolvedToolIds.map((id) => toolsById.get(id)?.name ?? id)
    blockers.push({
      code: 'unresolved-tools',
      label: `${agent.unresolvedToolIds.length} declared tool${agent.unresolvedToolIds.length > 1 ? 's' : ''} cannot run`,
      detail: `No registered handler for: ${names.join(', ')}.`,
    })
  }

  for (const field of agent.unavailableFields) {
    if (field === 'provider' || field === 'configuredModel' || field === 'version') {
      blockers.push({
        code: `missing-${field}`,
        label: `Missing ${field === 'configuredModel' ? 'model' : field}`,
        detail: 'The runtime cannot resolve this from persisted data, so a run cannot be started.',
      })
    }
  }

  // Mirrors `runtime-catalogue.isExecutable` — langgraph is the only executable
  // product runtime (AGENTS.md). This must be the SAME rule /admin/agents uses,
  // never a second one: a non-langgraph agent (runtime unset, 'direct', or any
  // other value) is never executable, but that is a distinct fact from the
  // LangGraph-specific reasons above (missing assistant, unresolved tools in the
  // graph registry) and must not be conflated with — or silently replaced by —
  // them. Only push this blocker when nothing else already explains why the
  // agent isn't executable per `isExecutable`, so a langgraph agent that is
  // otherwise healthy never gets a spurious runtime blocker, and a non-langgraph
  // agent gets exactly one clear reason instead of borrowed LangGraph wording.
  if (agent.runtime !== 'langgraph' && blockers.length === 0 && !isExecutable(agent)) {
    blockers.push({
      code: 'runtime-not-langgraph',
      label: `Runtime is ${agent.runtime ?? 'unset'}, not langgraph`,
      detail: 'LangGraph is the only executable product runtime; this agent has no wired execution path.',
    })
  }

  return blockers
}

export async function getAgentDetail(copilotId: string): Promise<AgentDetail | undefined> {
  const copilot = await getCopilot(copilotId)
  if (!copilot) return undefined

  const [
    agent,
    manifest,
    versions,
    tools,
    runs,
    delivery,
    testSuites,
    benchmarkSuites,
    improveProposal,
    telemetryResult,
    telemetry,
  ] = await Promise.all([
    getAvailableAgent(copilotId),
    getManifestForCopilot(copilotId),
    getVersionsForCopilot(copilotId),
    getToolsForCopilot(copilotId),
    getRunsForCopilot(copilotId, 50),
    getLatestDeliveryEvent(copilotId),
    getTestSuitesForCopilot(copilotId),
    getBenchmarkSuitesForCopilot(copilotId),
    getLatestProposalForCopilot(copilotId).catch((err: unknown) => {
      console.error('[agent-detail] failed to read the latest improvement proposal', err)
      return null
    }),
    // Fail-soft, deliberately: telemetry is documented best-effort everywhere
    // else in this codebase. A telemetry-read outage must degrade one
    // lifecycle stage to `unknown`, not take down the whole detail page.
    getLatestTelemetryEventForCopilot(copilotId)
      .then((event) => ({ event, failed: false as const }))
      .catch(() => ({ event: null, failed: true as const })),
    // Single-agent page, single extra PostgREST round trip — not the batched
    // overview wave (dashboard-overview.ts explicitly stays away from
    // per-copilot reads). A failed read reports itself as `null`, never an
    // empty/zeroed summary: `summarizeRuntimeTelemetry` throws on a hard
    // PostgREST error and this is the one place that catches it.
    summarizeRuntimeTelemetry(copilot.projectId ?? '', copilotId).catch(() => null),
  ])

  const improveComparison =
    improveProposal?.v2VersionId != null
      ? await compareImprovementVersions(copilotId, improveProposal.baseVersionId, improveProposal.v2VersionId).catch(
          (err: unknown) => {
            console.error('[agent-detail] failed to compare improvement versions', err)
            return null
          }
        )
      : null

  const toolsById = new Map(tools.map((t) => [t.id, t]))
  const blockers = computeBlockers(agent, toolsById)

  // Resolved from the CANONICAL project id, after `agent` is known — a
  // second, small round-trip rather than a fifth `Promise.all` entry, since
  // it depends on `agent.projectId`, not on `copilotId` alone. `getProject`
  // returning `undefined` (deleted project) collapses to the same
  // "no delivery target" state as no link at all; no error either way.
  const project = agent?.projectId == null ? undefined : await getProject(agent.projectId)

  const currentVersion =
    versions.find((v) => v.id === copilot.productionVersionId) ??
    versions.find((v) => v.id === copilot.latestVersionId) ??
    versions[0]

  // Consumer activation — the ONLY admissible source for `active_in_consumer`.
  // Sequenced after the wave rather than inside it because `delivered` comes
  // from the delivery event resolved above, and passing a guessed `delivered`
  // would corrupt the reason string the operator reads.
  //
  // FAIL-SOFT, BUT NOT FAIL-SILENT: a read failure degrades this ONE stage to
  // `unavailable` and never takes down the detail page — and it is never
  // flattened into `unknown`, which would report an outage as a measured
  // absence of consumer activity.
  const activation = await readConsumerActivation(copilotId, { delivered: delivery !== null }).then(
    (read): { read: ConsumerActivationRead | null; failed: false } => ({ read, failed: false }),
    (err: unknown): { read: null; failed: true } => {
      console.error('[agent-detail] consumer-activation read failed', err)
      return { read: null, failed: true }
    }
  )

  const lifecycle = buildLifecycleTrace({
    versions,
    currentVersion,
    delivery,
    lastTelemetry: telemetryResult.event,
    telemetryLookupFailed: telemetryResult.failed,
    hasV2Draft: versions.some((v) => v.createdBy === 'improvement-loop'),
    hasImprovementProposal: improveProposal !== null,
    consumerActivation: activation.read,
    consumerActivationLookupFailed: activation.failed,
  })

  return {
    copilot,
    agent,
    manifest,
    versions,
    currentVersion,
    tools,
    runs,
    blockers,
    executable: blockers.length === 0,
    metrics: computeMetrics(runs),
    delivery,
    testSuites,
    benchmarkSuites,
    improveProposal,
    improveComparison,
    project,
    lifecycle,
    telemetry,
  }
}
