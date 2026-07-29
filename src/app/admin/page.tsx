import type { Metadata } from 'next'

import { DashboardView } from '@/components/admin-dashboard/dashboard-view'
import { getDashboardPageData } from '@/lib/agent-mission-control/dashboard-page-data'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Fleet — Aigent',
}

export default async function DashboardPage() {
  const { overview } = await getDashboardPageData()
  return <DashboardView overview={overview} />
}
