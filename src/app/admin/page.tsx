import type { Metadata } from 'next'

import { ActionCenter } from '@/components/agent-ops/action-center'
import { ActiveDeliveryLoop } from '@/components/agent-ops/active-delivery-loop'
import { AgentDeliveryMatrix } from '@/components/agent-ops/agent-delivery-matrix'
import { DashboardDataWarnings, DashboardHeader, DashboardKpiStrip } from '@/components/agent-ops/dashboard-kpi-strip'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { surfaceCardClass } from '@/components/agent-ops/surface-card'
import { getDashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Agent Delivery Command Center — Aigent',
}

export default async function DashboardPage() {
  const overview = await getDashboardOverview()

  return (
    <div className="flex flex-col gap-8 pb-12">
      <StaggerFade delay={0}>
        <div className={surfaceCardClass}>
          <DashboardHeader />
          <DashboardDataWarnings warnings={overview.dataWarnings} />
          <DashboardKpiStrip kpis={overview.kpis} />
        </div>
      </StaggerFade>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <StaggerFade delay={1} className="xl:col-span-2">
          <ActiveDeliveryLoop items={overview.deliveryLoop} />
        </StaggerFade>
        <StaggerFade delay={2}>
          <ActionCenter items={overview.actionItems} />
        </StaggerFade>
      </div>

      <StaggerFade delay={3}>
        <AgentDeliveryMatrix rows={overview.deliveryMatrix} />
      </StaggerFade>
    </div>
  )
}
