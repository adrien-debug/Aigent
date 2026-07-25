import { getCopilots, getProjects, getRecentRunsInWindow } from '@/lib/agent-mission-control/data'
import type { AgentRun, Copilot, Project } from '@/lib/agent-mission-control/types'

/**
 * Newest runs shown in the feed table. The leaderboard ranks on each copilot's
 * own `health` snapshot (already resolved server-side, not on this page's
 * `runs` sample), so `RUNS_TABLE_SIZE` only bounds the trace feed's row count —
 * it does not silently cap what the leaderboard "saw".
 */
const RUNS_TABLE_SIZE = 30

/**
 * Bounded by the CANONICAL 24h window (real `started_at >= now-24h`), not by
 * a most-recent-N sample — a busy fleet no longer silently truncates the
 * window this page reasons over (see FIX 2 on `getRecentRunsInWindow`).
 */
const WINDOW_MAX_ROWS = 1000

export interface PerformancePageData {
  nowIso: string
  projectNameById: Map<string, string>
  copilotById: Map<string, Copilot>
  ranked: Copilot[]
  recentRuns: AgentRun[]
  /** Explicit, visible truncation notice — never a silently-capped feed presented as complete. */
  windowTruncated: boolean
  windowMaxRows: number
}

/**
 * `/admin/performance` data-fetch, extracted so `page.tsx` stays a pure
 * `data + <View />` shell (see `scripts/check-views.mjs`).
 */
export async function getPerformancePageData(): Promise<PerformancePageData> {
  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()

  const [copilots, projects, runs] = await Promise.all([
    getCopilots(),
    getProjects(),
    getRecentRunsInWindow({ nowMs, maxRows: WINDOW_MAX_ROWS }),
  ])

  const projectNameById = new Map<string, string>(projects.map((p: Project) => [p.id, p.name]))
  const copilotById = new Map(copilots.map((c) => [c.id, c]))
  // Leaderboard ranks on each copilot's server-resolved `health` snapshot
  // (testPassRate, runsLast24h) — NOT on this page's `runs` sample — so it
  // reflects the fleet's true standing regardless of how many rows the window
  // query capped at.
  const ranked = [...copilots].sort(
    (a, b) => b.health.runsLast24h - a.health.runsLast24h || a.name.localeCompare(b.name)
  )
  const recentRuns = runs.slice(0, RUNS_TABLE_SIZE)
  const windowTruncated = runs.length >= WINDOW_MAX_ROWS

  return { nowIso, projectNameById, copilotById, ranked, recentRuns, windowTruncated, windowMaxRows: WINDOW_MAX_ROWS }
}
