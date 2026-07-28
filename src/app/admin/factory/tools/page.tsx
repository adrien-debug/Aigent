import type { Metadata } from 'next'

import { FactoryToolsView } from '@/components/views/factory/factory-tools-view'
import { getFactoryToolsPageData } from '@/lib/agent-mission-control/factory-tools-page-data'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Build a tool — Aigent',
}

export default async function FactoryToolsPage() {
  const data = await getFactoryToolsPageData()
  return <FactoryToolsView {...data} />
}
