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
import type { CopilotStatus, DisplayStatus, IsoTimestamp, VersionStage } from './types'

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

/**
 * Resolve run-backed health for a BATCH of copilots. Returns a map keyed by
 * copilot id; a copilot with no completed run maps to the `none` baseline.
 */
export async function resolveCopilotHealthBatch(copilotIds: string[]): Promise<Map<string, ResolvedAgentHealth>> {
  const out = new Map<string, ResolvedAgentHealth>()
  if (copilotIds.length === 0) return out
  const [testByCopilot, benchByCopilot] = await Promise.all([
    latestTestRunByCopilot(copilotIds),
    latestBenchmarkByCopilot(copilotIds),
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
