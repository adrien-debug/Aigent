/**
 * Agent Mission Control — data layer (server only).
 *
 * LIVE ONLY. The single source is the gpu1 PostgREST perimeter (base `aigent`).
 * There is NO mock fallback: if the backend is not configured or unreachable,
 * every getter throws and the /admin error boundary shows a retry — the app
 * never fabricates data.
 *
 * Required env: AMC_DATA_SOURCE=gpu1, AMC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *
 * Never import this module from a client component: it reads the service role
 * key. Pages (server components) fetch and pass plain props.
 */
import 'server-only'

import { cache } from 'react'

import {
  deriveDisplayStatus,
  resolve24hMetricsBatch,
  resolveCopilotHealthBatch,
  resolveVersionScoresBatch,
  type ResolveCopilotHealthOptions,
  type ResolvedAgentHealth,
} from './agent-health'
import { camelRow, camelRows, pgrest, pgrestWithCount } from './postgrest'
import type {
  AgentManifest,
  AgentRun,
  AgentRunStep,
  BenchmarkResult,
  BenchmarkRun,
  BenchmarkSuite,
  Copilot,
  CopilotHealthMetric,
  CopilotVersion,
  Project,
  PromotionGate,
  RegistryWarning,
  ReplayComparison,
  ShadowExperiment,
  TestCase,
  TestResult,
  TestRun,
  TestSuite,
  ToolCall,
  ToolDefinition,
} from './types'

// PostgREST transport + case conversion come from the shared server-only client.
const rest = <T>(pathAndQuery: string): Promise<T> => pgrest<T>('GET', pathAndQuery)

type RawRow = Record<string, unknown>

/**
 * Normalise the run-time resolved-model columns on a freshly camel-cased run
 * row. `select=*` surfaces `resolved_model` / `resolved_provider` /
 * `model_unverified` (migration 0020) as `resolvedModel` / `resolvedProvider` /
 * `modelUnverified`, but a run that predates the migration (or a NULL from a
 * writer that never proved the model) leaves them `undefined`/`null`. We coerce
 * to the AgentRun contract: unknown model/provider → `null`, and `modelUnverified`
 * → `true` unless the DB explicitly proved otherwise (`=== false`). Absence of
 * proof is surfaced as unverified — never fabricated into a trusted model.
 */
function normalizeResolvedModel(run: AgentRun): AgentRun {
  run.resolvedModel = typeof run.resolvedModel === 'string' && run.resolvedModel.length > 0 ? run.resolvedModel : null
  run.resolvedProvider =
    typeof run.resolvedProvider === 'string' && run.resolvedProvider.length > 0 ? run.resolvedProvider : null
  run.modelUnverified = run.modelUnverified === false ? false : true
  return run
}

/** Run-backed 24h KPIs for one copilot — see agent-health.resolve24hMetricsBatch. */
type ResolvedKpi24h = {
  runsLast24h: number
  costLast24hUsd: number
  errorRateLast24h: number
}

// ---------------------------------------------------------------------------
// Getters — live PostgREST, async
// ---------------------------------------------------------------------------

export async function getProjects(): Promise<Project[]> {
  return camelRows<Project>(await rest<RawRow[]>('projects?select=*&order=created_at'))
}

export async function getProject(id: string): Promise<Project | undefined> {
  return camelRows<Project>(await rest<RawRow[]>(`projects?select=*&id=eq.${encodeURIComponent(id)}`))[0]
}

/**
 * Coerce the stored `copilots.health` jsonb into the `CopilotHealth` contract
 * and report which metrics it could NOT prove.
 *
 * `camelRows` casts the blob straight to `Copilot` without validating it, and
 * `scripts/provision-tradeagent-roster.mjs` writes `health: {}`, so in practice
 * a live row can arrive with every key `undefined`. Nothing downstream checked:
 * the Performance band summed those `undefined`s and printed the `NaN` as if it
 * were a measurement.
 *
 * The number written back for an unproven metric is a PLACEHOLDER, never a
 * claim — it exists only because the field is typed `number`, and every metric
 * it stands for is named in the returned list so a view renders a dash instead.
 * Same channel as `AvailableAgent.unavailableFields`.
 */
function normalizeHealth(copilot: Copilot): CopilotHealthMetric[] {
  // Spread tolerates a null/undefined blob (a copilot row whose column was
  // never written at all) without a cast.
  const raw: Record<string, unknown> = { ...copilot.health }
  const unavailable: CopilotHealthMetric[] = []
  const take = (metric: CopilotHealthMetric): number => {
    const value = raw[metric]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    unavailable.push(metric)
    return 0
  }
  copilot.health = {
    testPassRate: take('testPassRate'),
    benchmarkScore: take('benchmarkScore'),
    runsLast24h: take('runsLast24h'),
    errorRateLast24h: take('errorRateLast24h'),
    avgLatencyMs: take('avgLatencyMs'),
    costLast24hUsd: take('costLast24hUsd'),
    openWarnings: take('openWarnings'),
  }
  return unavailable
}

/**
 * Overwrite the stale `health.testPassRate`/`benchmarkScore` blob (written to 0
 * at creation, never recomputed) with run-backed truth, and attach the derived
 * `displayStatus` + `healthEvidence`. When a copilot has NO completed run the
 * resolver returns `null` and we keep the stored baseline untouched, so seeded
 * copilots (real stored scores) and the existing "not measured" guards both
 * still work. Every listing surface reads `.health.testPassRate` unchanged —
 * the value is simply now true. Display-only; never touches the DB or the gate.
 *
 * A metric that neither the stored blob nor a resolver could prove stays in
 * `healthUnavailableFields`: proving one REMOVES it from the list, so the list
 * and the numbers can never disagree.
 */
function enrichCopilot(
  copilot: Copilot,
  resolved: ResolvedAgentHealth | undefined,
  kpi24h: ResolvedKpi24h | undefined
): Copilot {
  copilot.displayStatus = deriveDisplayStatus({
    status: copilot.status,
    productionVersionId: copilot.productionVersionId,
  })
  copilot.healthEvidence = resolved?.evidenceSource ?? 'none'

  const unavailable = new Set(normalizeHealth(copilot))
  const prove = (metric: CopilotHealthMetric, value: number) => {
    copilot.health[metric] = value
    unavailable.delete(metric)
  }

  if (resolved && resolved.testPassRate !== null) prove('testPassRate', resolved.testPassRate)
  if (resolved && resolved.benchmarkScore !== null) prove('benchmarkScore', resolved.benchmarkScore)
  if (resolved && resolved.avgLatencyMs !== null) prove('avgLatencyMs', resolved.avgLatencyMs)
  // Overwrite the stale 24h blob with run-backed truth (same pattern as above).
  // Always applied — an absence of 24h runs is a real 0, not "keep the old lie".
  if (kpi24h) {
    prove('runsLast24h', kpi24h.runsLast24h)
    prove('costLast24hUsd', kpi24h.costLast24hUsd)
    prove('errorRateLast24h', kpi24h.errorRateLast24h)
  }

  copilot.healthUnavailableFields = [...unavailable]
  return copilot
}

export type GetCopilotsOptions = {
  /**
   * Health enrichment depth.
   * - `full` (default): test pass rate + benchmark + avg latency + 24h KPIs —
   *   needed by /admin/performance (fleet latency KPI).
   * - `list`: test pass rate + 24h KPIs only — skips benchmark fan-out and
   *   latency aggregation (~2–3 PostgREST RTTs). Use on dashboard / project /
   *   telemetry list surfaces that do not display those fields.
   */
  health?: 'full' | 'list'
}

function healthResolveOptions(mode: GetCopilotsOptions['health']): ResolveCopilotHealthOptions {
  if (mode === 'list') return { includeLatency: false, includeBenchmark: false }
  return {}
}

export async function getCopilots(options: GetCopilotsOptions = {}): Promise<Copilot[]> {
  const copilots = camelRows<Copilot>(await rest<RawRow[]>('copilots?select=*&order=name'))
  const ids = copilots.map((c) => c.id)
  const [health, kpi24h] = await Promise.all([
    resolveCopilotHealthBatch(ids, healthResolveOptions(options.health)),
    resolve24hMetricsBatch(ids),
  ])
  return copilots.map((c) => enrichCopilot(c, health.get(c.id), kpi24h.get(c.id)))
}

/**
 * One copilot, enriched with run-backed health + 24h KPIs.
 *
 * MEMOIZED PER REQUEST (`React.cache`): every `/admin/agents/[id]` screen calls
 * this twice — once in `layout.tsx` for the header, once in the page itself —
 * and each call costs 5 PostgREST round-trips (the row, plus the health and
 * 24h-KPI batch resolvers). At ~370ms per round-trip against the gpu1
 * perimeter that duplication alone cost ~1.8s per navigation.
 *
 * `React.cache` is scoped to the CURRENT REQUEST only, with no sharing between
 * requests, so this dedupes a render pass without weakening the module's
 * LIVE-only contract: `pgrest` still sends `cache: 'no-store'`, and the next
 * request re-reads the backend. Outside a React render (scripts, tests) the
 * wrapper is a passthrough — memoization needs a request scope to exist.
 */
export const getCopilot = cache(async function getCopilot(id: string): Promise<Copilot | undefined> {
  const copilot = camelRows<Copilot>(await rest<RawRow[]>(`copilots?select=*&id=eq.${encodeURIComponent(id)}`))[0]
  if (!copilot) return undefined
  const [health, kpi24h] = await Promise.all([
    resolveCopilotHealthBatch([copilot.id]),
    resolve24hMetricsBatch([copilot.id]),
  ])
  return enrichCopilot(copilot, health.get(copilot.id), kpi24h.get(copilot.id))
})

export async function getVersionsForCopilot(copilotId: string): Promise<CopilotVersion[]> {
  const versions = camelRows<CopilotVersion>(
    await rest<RawRow[]>(`copilot_versions?select=*&copilot_id=eq.${encodeURIComponent(copilotId)}&order=created_at.desc`)
  )
  const scores = await resolveVersionScoresBatch(versions.map((v) => v.id))
  return versions.map((version) => {
    const resolved = scores.get(version.id)
    version.scoresEvidence = resolved?.evidenceSource ?? 'none'
    // Same rule as copilots: run-backed value overwrites the stale zero blob;
    // no run → keep the stored baseline (seeded versions, un-run drafts).
    if (resolved && resolved.testPassRate !== null) version.scores.testPassRate = resolved.testPassRate
    if (resolved && resolved.benchmarkScore !== null) version.scores.benchmarkScore = resolved.benchmarkScore
    // Unsafe count follows the OPPOSITE rule: the stored blob is a zero-init
    // baseline, and "0 unsafe actions" is a safety claim no one measured. The
    // run-backed value wins even when it is null, so an un-benchmarked version
    // reads "not measured" instead of a reassuring zero.
    version.scores.unsafeActionCount = resolved?.unsafeActionCount ?? null
    return version
  })
}

/**
 * One version, with run-backed scores resolved over the stored blob.
 *
 * Memoized per request for the same reason as `getCopilot`: the agent detail
 * screen resolves up to three versions (production, latest, gate candidate)
 * and each call costs 2 round-trips. Callers treat the result as read-only —
 * the score fields below are written onto this function's OWN freshly-fetched
 * object before any caller sees it, so a shared instance is safe.
 */
export const getVersion = cache(async function getVersion(id: string): Promise<CopilotVersion | undefined> {
  const version = camelRows<CopilotVersion>(await rest<RawRow[]>(`copilot_versions?select=*&id=eq.${encodeURIComponent(id)}`))[0]
  if (!version) return undefined
  const resolved = (await resolveVersionScoresBatch([version.id])).get(version.id)
  version.scoresEvidence = resolved?.evidenceSource ?? 'none'
  if (resolved && resolved.testPassRate !== null) version.scores.testPassRate = resolved.testPassRate
  if (resolved && resolved.benchmarkScore !== null) version.scores.benchmarkScore = resolved.benchmarkScore
  // See getVersionsForCopilot: null wins over the zero-init blob.
  version.scores.unsafeActionCount = resolved?.unsafeActionCount ?? null
  return version
})

export async function getManifestForCopilot(copilotId: string): Promise<AgentManifest | undefined> {
  return camelRows<AgentManifest>(
    await rest<RawRow[]>(`manifests?select=*&copilot_id=eq.${encodeURIComponent(copilotId)}&order=updated_at.desc&limit=1`)
  )[0]
}

/**
 * A copilot's mounted tools. Memoized per request (see `getCopilot`): the
 * agent detail page and the async sections below it each resolve this
 * independently, so the `select=*` read ran twice per render.
 *
 * Measured, not assumed: query tracing showed this query drop from 2x to 1x
 * per render. The OTHER `tools?...` reads in the same render use a different
 * projection (`select=name,risk_level`) from a different function — memoizing
 * here does not and cannot touch those.
 *
 * Callers only read and filter (`.filter(t => t.enabled)` builds a new array),
 * never reorder in place.
 */
export const getToolsForCopilot = cache(async function getToolsForCopilot(
  copilotId: string
): Promise<ToolDefinition[]> {
  const rows = await rest<RawRow[]>(`tools?select=*&copilot_id=eq.${encodeURIComponent(copilotId)}&order=risk_level,name`)
  // copilot_id is a DB column, absent from ToolDefinition — drop it.
  return camelRows<ToolDefinition>(
    rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'copilot_id')))
  )
})

export async function getTestSuitesForCopilot(copilotId: string): Promise<TestSuite[]> {
  const rows = await rest<RawRow[]>(`test_suites?select=*,test_cases(id)&copilot_id=eq.${encodeURIComponent(copilotId)}&order=name`)
  return rows.map((r) => {
    const { test_cases, ...rest_ } = r as RawRow & { test_cases: { id: string }[] }
    const suite = camelRow<TestSuite>(rest_)
    suite.caseIds = (test_cases ?? []).map((c) => c.id)
    return suite
  })
}

export async function getTestCasesForSuite(suiteId: string): Promise<TestCase[]> {
  return camelRows<TestCase>(await rest<RawRow[]>(`test_cases?select=*&suite_id=eq.${encodeURIComponent(suiteId)}&order=id`))
}

export async function getTestRunsForCopilot(copilotId: string): Promise<TestRun[]> {
  const rows = await rest<RawRow[]>(
    `test_runs?select=*,test_results(id)&copilot_id=eq.${encodeURIComponent(copilotId)}&order=started_at.desc`
  )
  return rows.map((r) => {
    const { test_results, ...rest_ } = r as RawRow & { test_results: { id: string }[] }
    const run = camelRow<TestRun>(rest_)
    run.resultIds = (test_results ?? []).map((x) => x.id)
    return run
  })
}

export async function getTestResultsForRun(runId: string): Promise<TestResult[]> {
  return camelRows<TestResult>(await rest<RawRow[]>(`test_results?select=*&run_id=eq.${encodeURIComponent(runId)}&order=id`))
}

/**
 * Runs for a copilot, newest first. Bounded by `limit` (default 50) so this
 * stays a single fast PostgREST round trip regardless of how much traffic a
 * copilot has accumulated — callers that need the true full history should
 * paginate explicitly rather than removing the cap.
 */
export async function getRunsForCopilot(copilotId: string, limit = 50): Promise<AgentRun[]> {
  const rows = await rest<RawRow[]>(
    `agent_runs?select=*,agent_run_steps(id)&copilot_id=eq.${encodeURIComponent(copilotId)}&order=started_at.desc&limit=${limit}`
  )
  return rows.map((r) => {
    const { agent_run_steps, ...rest_ } = r as RawRow & { agent_run_steps: { id: string }[] }
    const run = normalizeResolvedModel(camelRow<AgentRun>(rest_))
    run.stepIds = (agent_run_steps ?? []).map((s) => s.id)
    return run
  })
}

export async function getRecentRuns(limit = 30): Promise<AgentRun[]> {
  const rows = await rest<RawRow[]>(`agent_runs?select=*,agent_run_steps(id)&order=started_at.desc&limit=${limit}`)
  return rows.map((r) => {
    const { agent_run_steps, ...rest_ } = r as RawRow & { agent_run_steps: { id: string }[] }
    const run = normalizeResolvedModel(camelRow<AgentRun>(rest_))
    run.stepIds = (agent_run_steps ?? []).map((s) => s.id)
    return run
  })
}

/** Traces for a project: the runs of ITS copilots (per-project Traces menu). */
export async function getRecentRunsForProject(projectId: string, limit = 30): Promise<AgentRun[]> {
  const rows = await rest<RawRow[]>(
    `agent_runs?select=*,agent_run_steps(id)&project_id=eq.${encodeURIComponent(projectId)}&order=started_at.desc&limit=${limit}`
  )
  return rows.map((r) => {
    const { agent_run_steps, ...rest_ } = r as RawRow & { agent_run_steps: { id: string }[] }
    const run = normalizeResolvedModel(camelRow<AgentRun>(rest_))
    run.stepIds = (agent_run_steps ?? []).map((s) => s.id)
    return run
  })
}

export async function getStepsForRun(runId: string): Promise<AgentRunStep[]> {
  return camelRows<AgentRunStep>(await rest<RawRow[]>(`agent_run_steps?select=*&run_id=eq.${encodeURIComponent(runId)}&order=index`))
}

export async function getToolCallsForRun(runId: string): Promise<ToolCall[]> {
  return camelRows<ToolCall>(await rest<RawRow[]>(`tool_calls?select=*&run_id=eq.${encodeURIComponent(runId)}&order=id`))
}

/**
 * Tool calls for a batch of runs — ONE PostgREST round trip via `run_id=in.(...)`
 * instead of one fetch per run. Use this whenever you need tool calls across a
 * run list (e.g. a runs table); use `getToolCallsForRun` for a single run.
 */
export async function getToolCallsForRuns(runIds: string[]): Promise<ToolCall[]> {
  if (runIds.length === 0) return []
  const ids = runIds.map((id) => encodeURIComponent(id)).join(',')
  return camelRows<ToolCall>(await rest<RawRow[]>(`tool_calls?select=*&run_id=in.(${ids})&order=id`))
}

export async function getBenchmarkSuitesForCopilot(copilotId: string): Promise<BenchmarkSuite[]> {
  return camelRows<BenchmarkSuite>(
    await rest<RawRow[]>(`benchmark_suites?select=*&copilot_id=eq.${encodeURIComponent(copilotId)}&order=name`)
  )
}

export async function getBenchmarkRunsForSuite(suiteId: string): Promise<BenchmarkRun[]> {
  return camelRows<BenchmarkRun>(
    await rest<RawRow[]>(`benchmark_runs?select=*&suite_id=eq.${encodeURIComponent(suiteId)}&order=started_at.desc`)
  )
}

/**
 * Benchmark runs across a batch of suites — ONE PostgREST round trip via
 * `suite_id=in.(...)` instead of one fetch per suite. Use this when scanning
 * all of a copilot's suites at once (e.g. the overview's best-candidate scan);
 * use `getBenchmarkRunsForSuite` for a single suite.
 */
export async function getBenchmarkRunsForSuites(suiteIds: string[]): Promise<BenchmarkRun[]> {
  if (suiteIds.length === 0) return []
  const ids = suiteIds.map((id) => encodeURIComponent(id)).join(',')
  return camelRows<BenchmarkRun>(
    await rest<RawRow[]>(`benchmark_runs?select=*&suite_id=in.(${ids})&order=started_at.desc`)
  )
}

export async function getBenchmarkResultForRun(runId: string): Promise<BenchmarkResult | undefined> {
  return camelRows<BenchmarkResult>(await rest<RawRow[]>(`benchmark_results?select=*&run_id=eq.${encodeURIComponent(runId)}`))[0]
}

/**
 * Benchmark results across a batch of runs — ONE PostgREST round trip via
 * `run_id=in.(...)` instead of one fetch per run. Use `getBenchmarkResultForRun`
 * for a single run.
 */
export async function getBenchmarkResultsForRuns(runIds: string[]): Promise<BenchmarkResult[]> {
  if (runIds.length === 0) return []
  const ids = runIds.map((id) => encodeURIComponent(id)).join(',')
  return camelRows<BenchmarkResult>(await rest<RawRow[]>(`benchmark_results?select=*&run_id=in.(${ids})`))
}

export async function getReplayComparisonsForCopilot(copilotId: string): Promise<ReplayComparison[]> {
  return camelRows<ReplayComparison>(
    await rest<RawRow[]>(`replay_comparisons?select=*&copilot_id=eq.${encodeURIComponent(copilotId)}&order=created_at.desc`)
  )
}

export async function getShadowExperimentsForCopilot(copilotId: string): Promise<ShadowExperiment[]> {
  return camelRows<ShadowExperiment>(
    await rest<RawRow[]>(`shadow_experiments?select=*&copilot_id=eq.${encodeURIComponent(copilotId)}&order=started_at.desc`)
  )
}

export async function getPromotionGateForCopilot(copilotId: string): Promise<PromotionGate | undefined> {
  return camelRows<PromotionGate>(
    await rest<RawRow[]>(`promotion_gates?select=*&copilot_id=eq.${encodeURIComponent(copilotId)}&order=last_evaluated_at.desc&limit=1`)
  )[0]
}

export async function getRecentWarnings(limit = 6): Promise<RegistryWarning[]> {
  return camelRows<RegistryWarning>(
    await rest<RawRow[]>(`registry_warnings?select=*&order=occurred_at.desc&limit=${limit}`)
  )
}

export interface RegistryKpis {
  totalCopilots: number
  activeCopilots: number
  avgTestPassRate: number
  runsLast24h: number
  totalCostLast24hUsd: number
  openWarnings: number
}

export async function getRegistryKpis(): Promise<RegistryKpis> {
  const copilots = await getCopilots()
  // "Measured" = has real run evidence (healthEvidence), NOT `testPassRate > 0`:
  // an agent that genuinely scores 0% must count, and the enriched blob is now
  // run-backed so the average reflects reality instead of stale zeros.
  const measured = copilots.filter((c) => c.healthEvidence === 'runs')
  return {
    totalCopilots: copilots.length,
    // Count anything serving production as active — the stored `status` column
    // stays `draft` after promotion, so use the derived displayStatus.
    activeCopilots: copilots.filter((c) => c.displayStatus === 'active' || c.displayStatus === 'production').length,
    avgTestPassRate:
      measured.length > 0 ? measured.reduce((s, c) => s + c.health.testPassRate, 0) / measured.length : 0,
    runsLast24h: copilots.reduce((s, c) => s + c.health.runsLast24h, 0),
    totalCostLast24hUsd: copilots.reduce((s, c) => s + c.health.costLast24hUsd, 0),
    openWarnings: copilots.reduce((s, c) => s + c.health.openWarnings, 0),
  }
}

/**
 * How many manifests actually declare a runtime-telemetry wrapper
 * (`manifests.telemetry` non-null, migration 0018).
 *
 * Feeds the telemetry health diagnostic, which must distinguish three states
 * that look identical from the outside: nobody opted in, someone opted in but
 * nothing arrives, and everything is fine. Returns `null` when PostgREST does
 * not report an exact count — the diagnostic then says the data is
 * unavailable rather than claiming zero agents declared it.
 */
export async function countManifestsWithTelemetryDeclared(): Promise<number | null> {
  const { count } = await pgrestWithCount('manifests?select=id&telemetry=not.is.null&limit=0')
  return count
}
