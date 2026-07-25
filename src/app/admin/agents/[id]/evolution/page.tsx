import { notFound } from 'next/navigation'

import { AgentEvolutionView } from '@/components/views/agents/agent-evolution-view'
import { getAgentEvolutionPageData } from '@/lib/agent-mission-control/agent-evolution-page-data'

export default async function AgentEvolutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getAgentEvolutionPageData(id)
  if (!data) notFound()

  return <AgentEvolutionView copilotId={id} {...data} />
}
