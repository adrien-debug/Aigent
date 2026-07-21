import type { Metadata } from 'next'

import { ActionCenter } from '@/components/agent-ops/action-center'
import { DashboardLiveRuns } from '@/components/agent-ops/dashboard-live-runs'
import { DashboardProjectList } from '@/components/agent-ops/dashboard-project-list'
import { DashboardDataWarnings, DashboardKpiStrip } from '@/components/agent-ops/dashboard-kpi-strip'
import { AdminPageHeader } from '@/components/agent-ops/surface-card'
import { getDashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Agent Delivery Command Center — Aigent',
}

export default async function DashboardPage() {
  const overview = await getDashboardOverview()

  return (
    <div className="flex flex-col gap-4 pb-8">
      <AdminPageHeader eyebrow="Dashboard" title="Agent Delivery Command Center" className="pb-0" />
      <DashboardKpiStrip kpis={overview.kpis} />
      <DashboardDataWarnings warnings={overview.dataWarnings} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ActionCenter items={overview.actionItems} />
        <DashboardLiveRuns />
        <div className="min-w-0 xl:col-span-2">
          <DashboardProjectList projects={overview.projects} />
        </div>
      </div>
    </div>
  )
}
