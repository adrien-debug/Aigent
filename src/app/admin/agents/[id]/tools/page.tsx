import { notFound } from 'next/navigation'

import { AgentToolsView } from '@/components/views/agents/agent-tools-view'
import { getAgentDetail } from '@/lib/agent-mission-control/agent-detail'

export default async function AgentToolsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getAgentDetail(id)
  if (!detail) notFound()

  return <AgentToolsView detail={detail} />
}
