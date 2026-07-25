import { notFound } from 'next/navigation'
import { AgentConfigurationView } from '@/components/views/agents/agent-configuration-view'
import { getAgentDetail } from '@/lib/agent-mission-control/agent-detail'

export default async function AgentConfigurationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getAgentDetail(id)
  if (!detail) notFound()

  return <AgentConfigurationView detail={detail} />
}
