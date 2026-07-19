import type { Metadata } from 'next'

import { ActionCenter } from '@/components/agent-ops/action-center'
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
    <div className="flex flex-col gap-8 pb-12">
      <AdminPageHeader eyebrow="Dashboard" title="Agent Delivery Command Center" />
      <DashboardKpiStrip kpis={overview.kpis} />
      <DashboardDataWarnings warnings={overview.dataWarnings} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <DashboardProjectList projects={overview.projects} />
        </div>
        <ActionCenter items={overview.actionItems} />
      </div>
    </div>
  )
}
