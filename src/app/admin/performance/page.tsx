import { BoltIcon } from '@heroicons/react/24/outline'
import type { Metadata } from 'next'

import { EmptyStatePanel } from '@/components/agent-ops/empty-state'
import { ActivityChart } from '@/components/agent-ops/performance/activity-chart'
import { AgentLeaderboard } from '@/components/agent-ops/performance/agent-leaderboard'
import { FleetKpiBand } from '@/components/agent-ops/performance/fleet-kpi-band'
import { FleetWatchlist } from '@/components/agent-ops/performance/fleet-watchlist'
import { LiveRefresh } from '@/components/agent-ops/performance/live-refresh'
import { RecentRunsTable } from '@/components/agent-ops/performance/recent-runs-table'
import { AdminPageHeader } from '@/components/agent-ops/surface-card'
import { getCopilots, getProjects, getRecentRuns } from '@/lib/agent-mission-control/data'
import type { Project } from '@/lib/agent-mission-control/types'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Performance — Aigent',
}

/** Newest runs shown in the feed table; the full 200-run sample feeds the chart/KPIs. */
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
  const [copilots, projects, runs] = await Promise.all([getCopilots(), getProjects(), getRecentRuns(200)])

  const { nowMs, nowIso } = renderInstant()

  const projectNameById = new Map<string, string>(projects.map((p: Project) => [p.id, p.name]))
  const copilotById = new Map(copilots.map((c) => [c.id, c]))
  const ranked = [...copilots].sort(
    (a, b) => b.health.runsLast24h - a.health.runsLast24h || a.name.localeCompare(b.name)
  )
  const recentRuns = runs.slice(0, RUNS_TABLE_SIZE)

  return (
    <div className="flex flex-col gap-4 pb-8">
      <AdminPageHeader
        eyebrow="Performance"
        title="Fleet Performance"
        actions={<LiveRefresh initialRefreshedAt={nowIso} />}
        className="pb-0"
      />
      <FleetKpiBand copilots={copilots} runs={runs} nowMs={nowMs} />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.85fr)]">
        <AgentLeaderboard copilots={ranked} projectNameById={projectNameById} />
        <div className="flex min-w-0 flex-col gap-4">
          <ActivityChart runs={runs} nowMs={nowMs} />
          <FleetWatchlist copilots={copilots} />
        </div>
      </div>

      {recentRuns.length > 0 ? (
        <RecentRunsTable
          runs={recentRuns}
          copilotById={copilotById}
          projectNameById={projectNameById}
          nowIso={nowIso}
        />
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
