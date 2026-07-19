import { BoltIcon, CpuChipIcon } from '@heroicons/react/24/outline'
import type { Metadata } from 'next'

import { EmptyState } from '@/components/agent-ops/empty-state'
import { ActivityChart } from '@/components/agent-ops/performance/activity-chart'
import { AgentLeaderboard } from '@/components/agent-ops/performance/agent-leaderboard'
import { FleetKpiBand } from '@/components/agent-ops/performance/fleet-kpi-band'
import { LiveRefresh } from '@/components/agent-ops/performance/live-refresh'
import { RecentRunsTable } from '@/components/agent-ops/performance/recent-runs-table'
import { surfaceCardClass, surfaceCardHeaderClass } from '@/components/agent-ops/surface-card'
import { getCopilots, getProjects, getRecentRuns } from '@/lib/agent-mission-control/data'
import type { Project } from '@/lib/agent-mission-control/types'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Performance — Aigent',
}

/** Newest runs shown in the feed table; the full 200-run sample feeds the chart/KPIs. */
const RUNS_TABLE_SIZE = 20

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
    <div className="flex flex-col gap-8 pb-12">
      <div className={surfaceCardClass}>
        <div className={`${surfaceCardHeaderClass} px-6 py-6 lg:px-8`}>
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">Performance</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Fleet Performance</h1>
          </div>
          <LiveRefresh initialRefreshedAt={nowIso} />
        </div>
        <FleetKpiBand copilots={copilots} runs={runs} nowMs={nowMs} />
      </div>

      <ActivityChart runs={runs} nowMs={nowMs} />

      {ranked.length > 0 ? (
        <AgentLeaderboard copilots={ranked} projectNameById={projectNameById} />
      ) : (
        <div className="rounded-2xl border border-dashed border-white/5 bg-white/[0.01]">
          <EmptyState
            icon={CpuChipIcon}
            title="No agents yet"
            description="Provision copilots in your projects to see fleet performance here."
          />
        </div>
      )}

      {recentRuns.length > 0 ? (
        <RecentRunsTable
          runs={recentRuns}
          copilotById={copilotById}
          projectNameById={projectNameById}
          nowIso={nowIso}
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-white/5 bg-white/[0.01]">
          <EmptyState
            icon={BoltIcon}
            title="No runs recorded"
            description="Runs appear here as soon as agents serve traffic in any project."
          />
        </div>
      )}
    </div>
  )
}
