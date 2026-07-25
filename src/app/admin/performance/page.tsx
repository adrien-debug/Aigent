import type { Metadata } from 'next'

import { PerformanceView } from '@/components/views/performance/performance-view'
import { getPerformancePageData } from '@/lib/agent-mission-control/performance-page-data'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Performance — Aigent',
}

export default async function PerformancePage() {
  const data = await getPerformancePageData()
  return <PerformanceView {...data} />
}
