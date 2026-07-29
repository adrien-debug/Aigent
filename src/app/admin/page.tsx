import type { Metadata } from 'next'

import { OverviewScreen } from '@/components/console/overview-screen'
import { getDashboardPageData } from '@/lib/agent-mission-control/dashboard-page-data'

export const metadata: Metadata = {
  title: 'Overview — Aigent',
}

export default async function AdminPage() {
  const { overview } = await getDashboardPageData()
  return <OverviewScreen overview={overview} />
}
