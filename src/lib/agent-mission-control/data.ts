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
import { sumMeasuredHealth, type MeasuredSum } from './health-measure'
import { camelRow, camelRows, pgrest } from './postgrest'
import { NON_EVALUATION_RUN_FILTER } from './types'
import type {
  AgentManifest,
  AgentRun,
  Copilot,
  CopilotHealthMetric,
  CopilotVersion,
  Project,
  TestCase,
  TestSuite,
  ToolDefinition,
} from './types'

/**
 * The canonical operational window for every "last 24h" surface. Both the
 * dashboard and the performance page must sample the SAME window, or their
 * activity/cost/status charts silently disagree — see `getRecentRunsInWindow`
 * and `resolve24hMetricsBatch` (agent-health.ts), which share this boundary.
 */
export const RUNS_24H_WINDOW_MS = 24 * 60 * 60 * 1000

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

  // A quality score is a MEASUREMENT only when a real run backs it. A value that
  // survives in the stored blob without run evidence is a creation placeholder
  // (`health: { testPassRate: 0, benchmarkScore: 0, ... }` seeded at authoring),
  // NOT a measured 0 — the only true stored scores (persist-trading-scores) were
  // removed. So prove from run-backed truth, else FORCE the field unavailable so
  // the view shows a dash instead of a fabricated 0%. (24h fields below are
  // always run-backed via kpi24h, where an empty window is a real measured 0.)
  if (resolved && resolved.testPassRate !== null) prove('testPassRate', resolved.testPassRate)
  else unavailable.add('testPassRate')
  if (resolved && resolved.benchmarkScore !== null) prove('benchmarkScore', resolved.benchmarkScore)
  else unavailable.add('benchmarkScore')
  if (resolved && resolved.avgLatencyMs !== null) prove('avgLatencyMs', resolved.avgLatencyMs)
  else unavailable.add('avgLatencyMs')
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

export async function getManifestForCopilot(copilotId: string): Promise<AgentManifest | undefined> {
  const copilotRows = await rest<RawRow[]>(
    `copilots?id=eq.${encodeURIComponent(copilotId)}&select=production_version_id,latest_version_id`
  )
  const copilot = copilotRows[0]
  if (!copilot) return undefined

  const versionId =
    (typeof copilot.production_version_id === 'string' && copilot.production_version_id.length > 0
      ? copilot.production_version_id
      : null) ??
    (typeof copilot.latest_version_id === 'string' && copilot.latest_version_id.length > 0
      ? copilot.latest_version_id
      : null)
  if (!versionId) return undefined

  const versionRows = await rest<RawRow[]>(
    `copilot_versions?id=eq.${encodeURIComponent(versionId)}&select=manifest_id`
  )
  const manifestId = versionRows[0]?.manifest_id
  if (typeof manifestId !== 'string' || manifestId.length === 0) return undefined

  return camelRows<AgentManifest>(
    await rest<RawRow[]>(`manifests?select=*&id=eq.${encodeURIComponent(manifestId)}&limit=1`)
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

/**
 * Runs for a copilot, newest first. Bounded by `limit` (default 50) so this
 * stays a single fast PostgREST round trip regardless of how much traffic a
 * copilot has accumulated — callers that need the true full history should
 * paginate explicitly rather than removing the cap.
 */
/** A copilot's recent OPERATIONAL runs (excludes test-case/benchmark-task eval
 * runs, same as getRecentRuns) — feeds the agent-detail run history and the
 * read_recent_runs tool, so "recent runs" means the same thing everywhere. */
export async function getRunsForCopilot(copilotId: string, limit = 50): Promise<AgentRun[]> {
  const rows = await rest<RawRow[]>(
    `agent_runs?select=*,agent_run_steps(id)&copilot_id=eq.${encodeURIComponent(copilotId)}&${NON_EVALUATION_RUN_FILTER}&order=started_at.desc&limit=${limit}`
  )
  return rows.map((r) => {
    const { agent_run_steps, ...rest_ } = r as RawRow & { agent_run_steps: { id: string }[] }
    const run = normalizeResolvedModel(camelRow<AgentRun>(rest_))
    run.stepIds = (agent_run_steps ?? []).map((s) => s.id)
    return run
  })
}

/**
 * Recent OPERATIONAL runs. Excludes evaluation runs (test-case + benchmark-task
 * runs) via NON_EVALUATION_RUN_FILTER, the SAME exclusion the 24h health
 * resolver (agent-health.ts) uses — so the dashboard/performance activity, cost
 * and status charts count one run universe, not two. Counting eval runs here
 * made a failing test case show as a "failed production run" and put two
 * different "24h runs" totals on one screen.
 */
export async function getRecentRuns(limit = 30): Promise<AgentRun[]> {
  const rows = await rest<RawRow[]>(
    `agent_runs?select=*,agent_run_steps(id)&${NON_EVALUATION_RUN_FILTER}&order=started_at.desc&limit=${limit}`
  )
  return rows.map((r) => {
    const { agent_run_steps, ...rest_ } = r as RawRow & { agent_run_steps: { id: string }[] }
    const run = normalizeResolvedModel(camelRow<AgentRun>(rest_))
    run.stepIds = (agent_run_steps ?? []).map((s) => s.id)
    return run
  })
}

/**
 * Recent OPERATIONAL runs bounded by the CANONICAL 24h window
 * (`RUNS_24H_WINDOW_MS`), not by a magic most-recent-N limit.
 *
 * Why this exists (FIX 2): the dashboard called `getRecentRuns(500)` and the
 * performance page `getRecentRuns(200)` — two different most-recent-N feeds of
 * the same stream. Both then bucket those rows into 24h hourly charts, so the
 * moment run volume crosses 200 the two pages sample DIFFERENT run sets over the
 * same nominal "24h" and their activity/cost/status charts diverge. This getter
 * makes "runs in the last 24h" mean exactly one thing everywhere: a real
 * `started_at >= now-24h` filter, the SAME boundary `resolve24hMetricsBatch`
 * uses for the KPI numbers — so the charts and the KPI headline can no longer
 * tell two different stories.
 *
 * `maxRows` is a safety cap against an unbounded window read, NOT the window
 * definition (the time filter is). If a genuinely busy 24h ever exceeds it, the
 * newest `maxRows` are returned (order is `started_at.desc`); callers that must
 * prove completeness should page. Same non-evaluation exclusion as
 * `getRecentRuns`. `nowMs` is injectable so a page can pin ONE render instant
 * shared with its client-side hourly bucketing.
 */
export async function getRecentRunsInWindow(
  { nowMs = Date.now(), maxRows = 1000 }: { nowMs?: number; maxRows?: number } = {}
): Promise<AgentRun[]> {
  const sinceIso = new Date(nowMs - RUNS_24H_WINDOW_MS).toISOString()
  const rows = await rest<RawRow[]>(
    `agent_runs?select=*,agent_run_steps(id)&started_at=gte.${encodeURIComponent(sinceIso)}&${NON_EVALUATION_RUN_FILTER}&order=started_at.desc&limit=${maxRows}`
  )
  return rows.map((r) => {
    const { agent_run_steps, ...rest_ } = r as RawRow & { agent_run_steps: { id: string }[] }
    const run = normalizeResolvedModel(camelRow<AgentRun>(rest_))
    run.stepIds = (agent_run_steps ?? []).map((s) => s.id)
    return run
  })
}

/**
 * Fleet-wide KPIs over the whole registry.
 *
 * TWO KINDS OF FIELD LIVE HERE, and the types say which is which.
 *
 *  · STRUCTURAL COUNTS (`totalCopilots`, `activeCopilots`) — how many rows the
 *    read returned, and how many of them carry a given status. Nobody has to
 *    "measure" a row into existence, so a `0` here is a fact and the type is a
 *    plain `number`.
 *  · MEASUREMENTS (`avgTestPassRate`, `runsLast24h`, `totalCostLast24hUsd`) —
 *    figures that only exist if something actually proved them. Every one of
 *    them is nullable, because "nobody measured this" is NOT zero: a fleet that
 *    has never been tested does not score 0%, and a cost nobody could read is
 *    not "$0.00". Null renders `Indisponible`.
 *
 * The two 24h fields carry their COVERAGE with them (`MeasuredSum`, from
 * `./health-measure` — the same record `/admin` and `/admin/projects` roll up
 * per project) instead of being bare numbers. A bare number cannot say whether
 * it covers the whole fleet or three agents out of eleven, and `value` is only
 * the exact total when `unmeasured === 0`; otherwise it is a LOWER BOUND that a
 * caller must disclose as such. `Cost24hCoverage` (dashboard-overview.ts) was
 * the other candidate and is the wrong one here: its denominator counts RUNS in
 * a window, whereas this rollup's unit of coverage is a COPILOT.
 */
export interface RegistryKpis {
  /** Copilot rows returned by the read. Structural — a real 0 is a real 0. */
  totalCopilots: number
  /** Rows whose derived `displayStatus` serves production. Structural. */
  activeCopilots: number
  /**
   * Mean `health.testPassRate` over the copilots a RUN backs
   * (`healthEvidence === 'runs'`), which is a different gate from the one the
   * 24h fields use and deliberately so — see the comment in the body.
   *
   * `null` when NOT ONE copilot carries run evidence. It used to return `0`
   * there, which told an operator that a never-tested fleet scores zero percent.
   * Same three states, same reason, as the per-project pass-rate mean in
   * `dashboard-overview.ts` (`ProjectOverviewItem.testPassRate`).
   */
  avgTestPassRate: number | null
  /**
   * Runs in the last 24h, summed over the copilots that PROVED the metric, with
   * the coverage of that sum.
   *  · `{ value: 0, measured: 0, unmeasured: 0 }` — EMPTY fleet, read OK. A
   *    measured zero at full coverage: no agent, no run to have been made.
   *  · `{ value, measured: n>0, unmeasured: 0 }` — the exact fleet total.
   *  · `{ value, measured: n>0, unmeasured: k>0 }` — a LOWER BOUND covering `n`
   *    of `n+k` agents; disclose the gap, never print it as "the total".
   *  · `null` — the fleet has copilots and not one proved a run count.
   *    `Indisponible`, never 0.
   *  · a failed READ never produces a value at all: `getCopilots()` throws and
   *    the throw propagates (see the body).
   */
  runsLast24h: MeasuredSum | null
  /**
   * Cost in USD over the last 24h — the SAME rule, the SAME function and the
   * SAME five states as `runsLast24h` above, so the two cannot disagree.
   * `null` renders `Indisponible`, never `$0.00`.
   */
  totalCostLast24hUsd: MeasuredSum | null
}

export async function getRegistryKpis(): Promise<RegistryKpis> {
  // A failed read THROWS here and never reaches the rollups below — the /admin
  // error boundary shows a retry (module header: "there is NO mock fallback").
  // That IS the honest "read impossible" branch, and it is deliberately not
  // caught into `null`: when the backend is unreachable the whole page is
  // unavailable, not one KPI, and swallowing the failure would render a calm
  // "Indisponible" over a dead perimeter while claiming the other counts are
  // real. What must never happen — a 0 standing in for an unread fleet — cannot
  // happen either way.
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
    // Pass rate keeps its OWN gate (`healthEvidence`) rather than
    // `isMeasuredHealth`: a benchmark-only copilot has run evidence while its
    // `testPassRate` is a placeholder that would drag the mean down, so the two
    // rules answer different questions. Unchanged from before; only the
    // no-support branch moved from a fabricated `0` to `null`.
    avgTestPassRate:
      measured.length > 0 ? measured.reduce((s, c) => s + c.health.testPassRate, 0) / measured.length : null,
    // ONE rule, ONE rollup, ONE module — `sumMeasuredHealth` (./health-measure),
    // the same call `/admin` and `/admin/projects` make per project, applied
    // here to the whole fleet. What it replaces on BOTH lines was
    // `copilots.reduce((s, c) => s + c.health.<metric>, 0)`, which consulted
    // nothing: `health.runsLast24h` and `health.costLast24hUsd` are
    // NORMALISATION PLACEHOLDERS whenever `healthUnavailableFields` names them
    // (see `normalizeHealth` above — an unreadable metric is written back as `0`
    // precisely because the field is typed `number`), so those two sums added
    // fillers to a total and reported the result as a fleet measurement.
    runsLast24h: sumMeasuredHealth(copilots, 'runsLast24h'),
    totalCostLast24hUsd: sumMeasuredHealth(copilots, 'costLast24hUsd'),
  }
}
