import { notFound } from 'next/navigation'

import { AgentBuilderView } from '@/components/views/agents/agent-builder-view'
import { AGENT_BUILDER_SLUG } from '@/lib/agent-mission-control/agent-builder-copilot'
import { getCopilot } from '@/lib/agent-mission-control/data'

// The section layout ([id]/layout.tsx) already resolves the agent and 404s
// when it is absent, so `!copilot` here is pure defence-in-depth.
export default async function BuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const copilot = await getCopilot(id)
  if (!copilot) notFound()

  return <AgentBuilderView copilot={copilot} isBuilderAgent={copilot.slug === AGENT_BUILDER_SLUG} />
}
