import type { Metadata } from 'next'

import { FactoryToolsView } from '@/components/views/factory/factory-tools-view'
import { getCertifiedFactoryTools } from '@/lib/agent-mission-control/factory-tools-page-data'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Build a tool — Aigent',
}

export default function FactoryToolsPage() {
  return <FactoryToolsView certifiedTools={getCertifiedFactoryTools()} />
}
