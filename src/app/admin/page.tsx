import type { Metadata } from 'next'

import { ActionCenter } from '@/components/agent-ops/action-center'
import { ActivityByProjectChart } from '@/components/agent-ops/dashboard-charts/activity-by-project-chart'
import { CostOverTimeChart } from '@/components/agent-ops/dashboard-charts/cost-over-time-chart'
import { RunStatusBreakdownChart } from '@/components/agent-ops/dashboard-charts/run-status-breakdown-chart'
import { RunsOverTimeChart } from '@/components/agent-ops/dashboard-charts/runs-over-time-chart'
import { DashboardLiveRuns } from '@/components/agent-ops/dashboard-live-runs'
import { DashboardProjectList } from '@/components/agent-ops/dashboard-project-list'
import { DashboardDataWarnings, DashboardKpiStrip } from '@/components/agent-ops/dashboard-kpi-strip'
import { AdminPageHeader } from '@/components/agent-ops/surface-card'
import { getDashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'
import { getRecentRuns } from '@/lib/agent-mission-control/data'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Agent Delivery Command Center — Aigent',
}

// getRecentRuns has a LIMIT (most-recent-N, not "everything in 24h"). 500 is
// comfortably above Aigent's current run volume so the 24h window isn't
// truncated in practice; if that ever stops holding, the charts would start
// silently dropping older hours — raise this or label the period explicitly.
const RECENT_RUNS_LIMIT = 500

/**
 * Explicitly impure clock read, isolated outside the component body (same
 * contract as `renderInstant` on the Performance page). The page is
 * force-dynamic, so a fresh instant per request is the intended behaviour —
 * captured ONCE so every time-derived surface (the hourly buckets of the runs
 * and cost charts) agrees on the same window.
 */
function renderInstantMs(): number {
  return Date.now()
}

export default async function DashboardPage() {
  const [overview, recentRuns] = await Promise.all([getDashboardOverview(), getRecentRuns(RECENT_RUNS_LIMIT)])
  const nowMs = renderInstantMs()

  return (
    <div className="flex flex-col gap-4 pb-8">
      <AdminPageHeader eyebrow="Dashboard" title="Agent Delivery Command Center" className="pb-0" />
      <DashboardKpiStrip kpis={overview.kpis} />
      <DashboardDataWarnings warnings={overview.dataWarnings} />

      {/* ONE break column for the whole cockpit: every split row is 1/2 + 1/2, so
          the vertical seam falls at the same x on rows 3, 4 and 5. A 2/3 + 1/3
          row here broke at a different point and read as a misalignment against
          the rows above and below.

          `items-stretch` + a flex column per cell so both panels end on the SAME
          baseline instead of at their own natural heights. */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col">
          <RunsOverTimeChart runs={recentRuns} nowMs={nowMs} />
        </div>
        <div className="flex min-w-0 flex-col">
          <RunStatusBreakdownChart runs={recentRuns} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ActionCenter items={overview.actionItems} />
        <DashboardLiveRuns />
      </div>

      {/* Same rule as row 3: equal halves, equal baselines. Activity-by-project
          has one bar per ACTIVE project so it is usually the shorter card — its
          body centres its bars rather than leaving dead space at the bottom. */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col">
          <CostOverTimeChart runs={recentRuns} nowMs={nowMs} />
        </div>
        <div className="flex min-w-0 flex-col">
          <ActivityByProjectChart projects={overview.projects} />
        </div>
      </div>

      <DashboardProjectList projects={overview.projects} />
    </div>
  )
}
