import { notFound } from 'next/navigation'

import { AgentObservabilityView } from '@/components/views/agents/agent-observability-view'
import { getAgentObservabilityPageData } from '@/lib/agent-mission-control/agent-observability-page-data'

export default async function AgentObservabilityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getAgentObservabilityPageData(id)
  if (!data) notFound()

  return <AgentObservabilityView {...data} />
}
