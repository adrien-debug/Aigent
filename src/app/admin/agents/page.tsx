import type { Metadata } from 'next'

import { AgentsListView } from '@/components/views/agents/agents-list-view'
import { getAgentsListPageData } from '@/lib/agent-mission-control/agents-list-page-data'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Agents — Aigent',
}

export default async function AgentsPage() {
  const data = await getAgentsListPageData()
  return <AgentsListView {...data} />
}
