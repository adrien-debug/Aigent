import type { Metadata } from 'next'

import { FactoryView } from '@/components/views/factory/factory-view'
import { getFactoryPageData } from '@/lib/agent-mission-control/factory-page-data'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Factory — Aigent',
}

export default async function FactoryPage() {
  return <FactoryView {...(await getFactoryPageData())} />
}
