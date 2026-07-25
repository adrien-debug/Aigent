import { notFound } from 'next/navigation'

import { AgentOverviewView } from '@/components/views/agents/agent-overview-view'
import { getAgentDetail } from '@/lib/agent-mission-control/agent-detail'

export default async function AgentOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getAgentDetail(id)
  if (!detail) notFound()

  return <AgentOverviewView detail={detail} />
}
