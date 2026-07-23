import { BoltIcon } from '@heroicons/react/24/outline'
import type { Metadata } from 'next'

import { EmptyStatePanel } from '@/components/agent-ops/empty-state'
import { AgentLeaderboard } from '@/components/agent-ops/performance/agent-leaderboard'
import { LiveRefresh } from '@/components/agent-ops/performance/live-refresh'
import { RecentRunsTable } from '@/components/agent-ops/performance/recent-runs-table'
import { AdminPageHeader } from '@/components/agent-ops/surface-card'
import { Text } from '@/components/catalyst/text'
import { getCopilots, getProjects, getRecentRunsInWindow } from '@/lib/agent-mission-control/data'
import type { Project } from '@/lib/agent-mission-control/types'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Performance — Aigent',
}

/**
 * Newest runs shown in the feed table. The leaderboard ranks on each copilot's
 * own `health` snapshot (already resolved server-side, not on this page's
 * `runs` sample), so `RUNS_TABLE_SIZE` only bounds the trace feed's row count —
 * it does not silently cap what the leaderboard "saw".
 */
const RUNS_TABLE_SIZE = 30

/**
 * Explicitly impure clock read, isolated outside the component body (same
 * contract as `formatScanAge` in project-repo-intelligence). The page is
 * force-dynamic and LiveRefresh re-renders it every 30s — a fresh instant per
 * request is the intended behavior, captured ONCE so every time-derived
 * surface (chart buckets, KPI peak/hour hint, relative "Started" cells) agrees.
 */
function renderInstant(): { nowMs: number; nowIso: string } {
  const nowMs = Date.now()
  return { nowMs, nowIso: new Date(nowMs).toISOString() }
}

export default async function PerformancePage() {
  const { nowMs, nowIso } = renderInstant()

  // Bounded by the CANONICAL 24h window (real `started_at >= now-24h`), not by
  // a most-recent-N sample — a busy fleet no longer silently truncates the
  // window this page reasons over (see FIX 2 on `getRecentRunsInWindow`).
  const WINDOW_MAX_ROWS = 1000
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
  // Explicit, visible truncation notice — never a silently-capped feed
  // presented as complete.
  const windowTruncated = runs.length >= WINDOW_MAX_ROWS

  return (
    <div className="flex flex-col gap-4 pb-8">
      <AdminPageHeader
        eyebrow="Performance"
        title="Fleet Performance"
        actions={<LiveRefresh initialRefreshedAt={nowIso} />}
        className="pb-0"
      />

      <AgentLeaderboard copilots={ranked} projectNameById={projectNameById} />

      {recentRuns.length > 0 ? (
        <>
          <RecentRunsTable
            runs={recentRuns}
            copilotById={copilotById}
            projectNameById={projectNameById}
            nowIso={nowIso}
          />
          {windowTruncated ? (
            <Text className="text-xs text-zinc-500">
              24h window capped at {WINDOW_MAX_ROWS} runs — the fleet produced more than this in the
              last 24h; the trace feed below reflects the newest {WINDOW_MAX_ROWS}, not every run.
            </Text>
          ) : null}
        </>
      ) : (
        // Same surface as the table it stands in for, so the page keeps its
        // structure with or without runs.
        <EmptyStatePanel
          icon={BoltIcon}
          title="No runs recorded"
          description="Runs appear here as soon as agents serve traffic in any project. This reflects recorded runs only — it is not evidence that agents are idle."
        />
      )}
    </div>
  )
}
