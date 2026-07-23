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

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Agent Delivery Command Center — Aigent',
}

/**
 * Explicitly impure clock read, isolated outside the component body (same
 * contract as `renderInstant` on the Performance page). The page is
 * force-dynamic, so a fresh instant per request is the intended behaviour —
 * captured ONCE and passed into `getDashboardOverview` so the KPI window, the
 * hourly chart buckets and the shared `windowRuns` all agree on one instant
 * instead of drifting across two separate loads.
 */
function renderInstantMs(): number {
  return Date.now()
}

export default async function DashboardPage() {
  const nowMs = renderInstantMs()
  const overview = await getDashboardOverview(nowMs)
  const recentRuns = overview.windowRuns

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
