import type { Metadata } from 'next'

import { DashboardView } from '@/components/views/dashboard/dashboard-view'
import { getDashboardPageData } from '@/lib/agent-mission-control/dashboard-page-data'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Agent Delivery Command Center — Aigent',
}

export default async function DashboardPage() {
  const { overview, nowMs } = await getDashboardPageData()
  return <DashboardView overview={overview} nowMs={nowMs} />
}
