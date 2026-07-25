import { notFound } from 'next/navigation'
import { AgentInstructionsView } from '@/components/views/agents/agent-instructions-view'
import { getAgentDetail } from '@/lib/agent-mission-control/agent-detail'

export default async function AgentInstructionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getAgentDetail(id)
  if (!detail) notFound()

  return <AgentInstructionsView detail={detail} />
}
