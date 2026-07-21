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

export default async function DashboardPage() {
  const [overview, recentRuns] = await Promise.all([getDashboardOverview(), getRecentRuns(RECENT_RUNS_LIMIT)])
  const nowMs = Date.now()

  return (
    <div className="flex flex-col gap-4 pb-8">
      <AdminPageHeader eyebrow="Dashboard" title="Agent Delivery Command Center" className="pb-0" />
      <DashboardKpiStrip kpis={overview.kpis} />
      <DashboardDataWarnings warnings={overview.dataWarnings} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <RunsOverTimeChart runs={recentRuns} nowMs={nowMs} />
        </div>
        <div className="min-w-0">
          <RunStatusBreakdownChart runs={recentRuns} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ActionCenter items={overview.actionItems} />
        <DashboardLiveRuns />
      </div>

      {/* `items-start`: these two cards have genuinely different natural heights
          (activity-by-project has one row per ACTIVE project, often just a few).
          Stretching them to match would pad the shorter one into a tall empty
          box — a panel sized by its neighbour rather than by its content. */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <CostOverTimeChart runs={recentRuns} nowMs={nowMs} />
        </div>
        <div className="min-w-0">
          <ActivityByProjectChart projects={overview.projects} />
        </div>
      </div>

      <DashboardProjectList projects={overview.projects} />
    </div>
  )
}
