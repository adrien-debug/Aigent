import { notFound } from 'next/navigation'

import { AgentReleaseView } from '@/components/views/agents/agent-release-view'
import { getAgentReleasePageData } from '@/lib/agent-mission-control/agent-release-page-data'

export default async function AgentReleasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getAgentReleasePageData(id)
  if (!data) notFound()

  return <AgentReleaseView {...data} />
}
