/**
 * Agent Mission Control — canonical health/scores resolver (server only).
 *
 * THE dette this fixes: `copilots.health.testPassRate` and
 * `copilot_versions.scores.testPassRate` / `.benchmarkScore` are written ONCE at
 * creation (hard-coded to 0) and NEVER recomputed after a run. The real results
 * live in `test_runs.pass_rate` and `benchmark_runs` → `benchmark_results.score`
 * — which the release gate already reads correctly. Every listing/overview
 * surface still read the stale blob, so a copilot that passes 5/5 showed 0.0%.
 *
 * This module derives the CURRENT truth from the real runs, batched (one
 * PostgREST round trip per table across ALL ids, never N+1), and the data layer
 * (`data.ts`) overwrites the stale blob fields with it inside `getCopilots` /
 * `getCopilot` / `getVersionsForCopilot`. UI keeps reading `.health.testPassRate`
 * / `.scores.testPassRate` unchanged — the value is now real. No fabrication:
 * with no completed run the value is left at its stored (zero) baseline and the
 * existing "not measured" guards keep rendering a dash, never a scary 0.0%.
 *
 * The release gate stays the single source of truth for PROMOTION (it pins to a
 * candidate version and blocks on missing evidence). This resolver only feeds
 * DISPLAY surfaces; it never gates anything.
 *
 * Never import from a client component (reads the service-role key).
 */
import 'server-only'

import { pgrest } from './postgrest'
import type { CopilotStatus, DisplayStatus, IsoTimestamp, UsdAmount, VersionStage } from './types'

type RawRow = Record<string, unknown>

const inList = (ids: string[]) => ids.map((id) => encodeURIComponent(id)).join(',')

/** Derived, run-backed health for one copilot. `null` = no completed run yet. */
export interface ResolvedAgentHealth {
  /** 0..1 from the latest COMPLETED test_run's pass_rate. `null` if never run. */
  testPassRate: number | null
  latestTestRunId: string | null
  latestTestRunAt: IsoTimestamp | null
  /** 0..100 from the latest COMPLETED benchmark's result score. `null` if never run. */
  benchmarkScore: number | null
  latestBenchmarkRunId: string | null
  latestBenchmarkRunAt: IsoTimestamp | null
  /** Mean `test_results.latency_ms` over the latest COMPLETED test_run's cases. `null` if never run. */
  avgLatencyMs: number | null
  /** Where the numbers came from — `runs` when at least one exists, else `none`. */
  evidenceSource: 'runs' | 'none'
}

/**
 * Display status derived from the production pointer + version stage, decoupled
 * from the raw `copilots.status` column (which stays `draft` even after a
 * version is promoted — see the promotion route, which never PATCHes it). This
 * is display-only; it never changes what the DB stores or what the gate checks.
 * The `DisplayStatus` type lives in types.ts (shared with the Copilot shape).
 */
export function deriveDisplayStatus(input: {
  status: CopilotStatus
  productionVersionId: string | null
  productionStage?: VersionStage | null
}): DisplayStatus {
  // A live production version is the strongest signal — surface it even when the
  // stale `status` column still says draft.
  if (input.productionVersionId !== null || input.productionStage === 'production') return 'production'
  return input.status
}

const EMPTY: ResolvedAgentHealth = {
  testPassRate: null,
  latestTestRunId: null,
  latestTestRunAt: null,
  benchmarkScore: null,
  latestBenchmarkRunId: null,
  latestBenchmarkRunAt: null,
  avgLatencyMs: null,
  evidenceSource: 'none',
}

/**
 * Latest COMPLETED test_run per copilot, across a batch of copilot ids. One
 * PostgREST round trip; we take the first (newest) row per copilot from a
 * `started_at.desc` ordering.
 */
async function latestTestRunByCopilot(copilotIds: string[]): Promise<Map<string, { id: string; passRate: number; at: string }>> {
  const out = new Map<string, { id: string; passRate: number; at: string }>()
  if (copilotIds.length === 0) return out
  const rows = await pgrest<RawRow[]>(
    'GET',
    `test_runs?copilot_id=in.(${inList(copilotIds)})&status=eq.completed&select=id,copilot_id,pass_rate,started_at&order=started_at.desc`
  )
  for (const r of rows) {
    const cid = r.copilot_id as string
    if (out.has(cid)) continue // rows are newest-first → first seen wins
    out.set(cid, { id: r.id as string, passRate: (r.pass_rate as number) ?? 0, at: r.started_at as string })
  }
  return out
}

/**
 * Mean `test_results.latency_ms` over the cases of each copilot's latest
 * COMPLETED test_run (the same run `latestTestRunByCopilot` picked). Two
 * round trips: resolve the winning run ids, then batch-average their cases.
 */
async function avgLatencyByTestRun(runIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (runIds.length === 0) return out
  const rows = await pgrest<RawRow[]>(
    'GET',
    `test_results?run_id=in.(${inList(runIds)})&select=run_id,latency_ms`
  )
  const sumByRun = new Map<string, { total: number; count: number }>()
  for (const r of rows) {
    const rid = r.run_id as string
    const ms = r.latency_ms as number | null
    if (ms === null || ms === undefined) continue
    const acc = sumByRun.get(rid) ?? { total: 0, count: 0 }
    acc.total += ms
    acc.count += 1
    sumByRun.set(rid, acc)
  }
  for (const [rid, acc] of sumByRun) {
    if (acc.count > 0) out.set(rid, Math.round(acc.total / acc.count))
  }
  return out
}

/**
 * Latest COMPLETED benchmark score per copilot, across a batch. Two round trips:
 * the newest completed benchmark_run per copilot, then its result score.
 */
async function latestBenchmarkByCopilot(copilotIds: string[]): Promise<Map<string, { id: string; score: number; at: string }>> {
  const out = new Map<string, { id: string; score: number; at: string }>()
  if (copilotIds.length === 0) return out
  const runs = await pgrest<RawRow[]>(
    'GET',
    `benchmark_runs?copilot_id=in.(${inList(copilotIds)})&status=eq.completed&select=id,copilot_id,started_at&order=started_at.desc`
  )
  const newestByCopilot = new Map<string, { id: string; at: string }>()
  for (const r of runs) {
    const cid = r.copilot_id as string
    if (newestByCopilot.has(cid)) continue
    newestByCopilot.set(cid, { id: r.id as string, at: r.started_at as string })
  }
  const runIds = [...newestByCopilot.values()].map((v) => v.id)
  if (runIds.length === 0) return out
  const results = await pgrest<RawRow[]>('GET', `benchmark_results?run_id=in.(${inList(runIds)})&select=run_id,score`)
  const scoreByRunId = new Map(results.map((r) => [r.run_id as string, (r.score as number) ?? 0]))
  for (const [cid, run] of newestByCopilot) {
    if (!scoreByRunId.has(run.id)) continue // run without a result row → no evidence
    out.set(cid, { id: run.id, score: scoreByRunId.get(run.id)!, at: run.at })
  }
  return out
}

export type ResolveCopilotHealthOptions = {
  /**
   * When false, skip `test_results` latency aggregation (saves one PostgREST
   * RTT after the latest test run is known). Default true.
   */
  includeLatency?: boolean
  /**
   * When false, skip benchmark_runs + benchmark_results (saves up to two
   * sequential RTTs). Default true. List surfaces that only need pass rate /
   * evidence can opt out.
   */
  includeBenchmark?: boolean
}

/**
 * Resolve run-backed health for a BATCH of copilots. Returns a map keyed by
 * copilot id; a copilot with no completed run maps to the `none` baseline.
 *
 * Latency is overlapped with the benchmark fan-out when both are requested, so
 * the slow path is max(bench depth, latency) rather than bench + latency.
 */
export async function resolveCopilotHealthBatch(
  copilotIds: string[],
  options: ResolveCopilotHealthOptions = {}
): Promise<Map<string, ResolvedAgentHealth>> {
  const includeLatency = options.includeLatency !== false
  const includeBenchmark = options.includeBenchmark !== false
  const out = new Map<string, ResolvedAgentHealth>()
  if (copilotIds.length === 0) return out

  const testByCopilot = await latestTestRunByCopilot(copilotIds)
  const [benchByCopilot, latencyByRunId] = await Promise.all([
    includeBenchmark ? latestBenchmarkByCopilot(copilotIds) : Promise.resolve(new Map()),
    includeLatency
      ? avgLatencyByTestRun([...testByCopilot.values()].map((t) => t.id))
      : Promise.resolve(new Map<string, number>()),
  ])

  for (const id of copilotIds) {
    const t = testByCopilot.get(id)
    const b = benchByCopilot.get(id)
    out.set(id, {
      testPassRate: t ? t.passRate : null,
      latestTestRunId: t ? t.id : null,
      latestTestRunAt: t ? t.at : null,
      benchmarkScore: b ? b.score : null,
      latestBenchmarkRunId: b ? b.id : null,
      latestBenchmarkRunAt: b ? b.at : null,
      avgLatencyMs: t ? latencyByRunId.get(t.id) ?? null : null,
      evidenceSource: t || b ? 'runs' : 'none',
    })
  }
  return out
}

/** Resolve run-backed health for a single copilot. */
export async function resolveCopilotHealth(copilotId: string): Promise<ResolvedAgentHealth> {
  const map = await resolveCopilotHealthBatch([copilotId])
  return map.get(copilotId) ?? EMPTY
}

/** Derived, run-backed scores for one version. `null` = never run at that version. */
export interface ResolvedVersionScores {
  testPassRate: number | null
  benchmarkScore: number | null
  evidenceSource: 'runs' | 'none'
}

/**
 * Resolve run-backed scores for a BATCH of versions — same evidence the release
 * gate uses (runs PINNED to `version_id`), so the Release comparison table and
 * the gate agree. Returns a map keyed by version id.
 */
export async function resolveVersionScoresBatch(versionIds: string[]): Promise<Map<string, ResolvedVersionScores>> {
  const out = new Map<string, ResolvedVersionScores>()
  if (versionIds.length === 0) return out

  const testRuns = await pgrest<RawRow[]>(
    'GET',
    `test_runs?version_id=in.(${inList(versionIds)})&status=eq.completed&select=id,version_id,pass_rate,started_at&order=started_at.desc`
  )
  const passRateByVersion = new Map<string, number>()
  for (const r of testRuns) {
    const vid = r.version_id as string
    if (passRateByVersion.has(vid)) continue
    passRateByVersion.set(vid, (r.pass_rate as number) ?? 0)
  }

  const benchRuns = await pgrest<RawRow[]>(
    'GET',
    `benchmark_runs?version_id=in.(${inList(versionIds)})&status=eq.completed&select=id,version_id,started_at&order=started_at.desc`
  )
  const newestBenchRunByVersion = new Map<string, string>()
  for (const r of benchRuns) {
    const vid = r.version_id as string
    if (newestBenchRunByVersion.has(vid)) continue
    newestBenchRunByVersion.set(vid, r.id as string)
  }
  const benchRunIds = [...newestBenchRunByVersion.values()]
  const scoreByRunId = new Map<string, number>()
  if (benchRunIds.length > 0) {
    const results = await pgrest<RawRow[]>('GET', `benchmark_results?run_id=in.(${inList(benchRunIds)})&select=run_id,score`)
    for (const r of results) scoreByRunId.set(r.run_id as string, (r.score as number) ?? 0)
  }

  for (const vid of versionIds) {
    const testPassRate = passRateByVersion.has(vid) ? passRateByVersion.get(vid)! : null
    const benchRunId = newestBenchRunByVersion.get(vid)
    const benchmarkScore = benchRunId && scoreByRunId.has(benchRunId) ? scoreByRunId.get(benchRunId)! : null
    out.set(vid, {
      testPassRate,
      benchmarkScore,
      evidenceSource: testPassRate !== null || benchmarkScore !== null ? 'runs' : 'none',
    })
  }
  return out
}

/**
 * Rolling-24h operational metrics for one copilot, computed from the REAL
 * `agent_runs` rows in the window — NOT the `copilots.health` blob, which is
 * written once at creation (hard-coded 0) and never recomputed. That stale blob
 * showed "0 runs/24h" while `agent_runs` held real runs: the lie this resolves.
 *
 * All three fields are always real numbers (never null): an empty window is a
 * legitimate zero — the copilot genuinely had no run in the last 24h — which is
 * a measured fact, not fabricated data.
 */
export interface Resolved24hMetrics {
  /** Count of `agent_runs` with `started_at >= now-24h`. */
  runsLast24h: number
  /** Sum of `cost_usd` over the window, lossless (integer micro-USD, one divide). */
  costLast24hUsd: UsdAmount
  /** Fraction (0..1) of window runs that ended in a hard failure. `0` when no run. */
  errorRateLast24h: number
}

/** A window run that ended badly counts toward the error rate. `running` / `needs-confirmation` are in-flight, not failures. */
const ERROR_RUN_STATUSES = new Set(['failed', 'blocked'])

const EMPTY_24H: Resolved24hMetrics = { runsLast24h: 0, costLast24hUsd: 0, errorRateLast24h: 0 }

/**
 * Resolve rolling-24h metrics for a BATCH of copilots in ONE PostgREST round
 * trip: a single aggregate read of `agent_runs?started_at=gte.<now-24h>` scoped
 * to the requested ids, grouped by `copilot_id` in memory. Returns a map keyed
 * by copilot id; a copilot with no run in the window maps to the zero baseline.
 *
 * Money is summed losslessly: each `cost_usd` is rounded to micro-USD (6 dp) and
 * accumulated as an integer, with a single final divide — no float drift from
 * repeated addition. `null`/absent `cost_usd` contributes nothing.
 */
export async function resolve24hMetricsBatch(copilotIds: string[]): Promise<Map<string, Resolved24hMetrics>> {
  const out = new Map<string, Resolved24hMetrics>()
  if (copilotIds.length === 0) return out
  for (const id of copilotIds) out.set(id, { ...EMPTY_24H })

  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const rows = await pgrest<RawRow[]>(
    'GET',
    `agent_runs?copilot_id=in.(${inList(copilotIds)})&started_at=gte.${encodeURIComponent(sinceIso)}&select=copilot_id,status,cost_usd`
  )

  // Accumulate per copilot: run count, integer micro-USD cost, error count.
  const acc = new Map<string, { runs: number; microUsd: number; errors: number }>()
  for (const id of copilotIds) acc.set(id, { runs: 0, microUsd: 0, errors: 0 })
  for (const r of rows) {
    const cid = r.copilot_id as string
    const a = acc.get(cid)
    if (!a) continue // defensive: PostgREST only returns the ids we asked for
    a.runs += 1
    const cost = r.cost_usd
    if (typeof cost === 'number' && Number.isFinite(cost)) a.microUsd += Math.round(cost * 1_000_000)
    if (typeof r.status === 'string' && ERROR_RUN_STATUSES.has(r.status)) a.errors += 1
  }

  for (const id of copilotIds) {
    const a = acc.get(id)!
    out.set(id, {
      runsLast24h: a.runs,
      costLast24hUsd: a.microUsd / 1_000_000,
      errorRateLast24h: a.runs > 0 ? a.errors / a.runs : 0,
    })
  }
  return out
}

/** Resolve rolling-24h metrics for a single copilot. */
export async function resolve24hMetrics(copilotId: string): Promise<Resolved24hMetrics> {
  const map = await resolve24hMetricsBatch([copilotId])
  return map.get(copilotId) ?? { ...EMPTY_24H }
}
