import { notFound } from 'next/navigation'

import { AgentRunsView } from '@/components/views/agents/agent-runs-view'
import { getAgentDetail } from '@/lib/agent-mission-control/agent-detail'

export default async function AgentRunsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getAgentDetail(id)
  if (!detail) notFound()

  return <AgentRunsView detail={detail} />
}
