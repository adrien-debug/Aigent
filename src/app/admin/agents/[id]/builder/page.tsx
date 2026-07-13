import { notFound } from 'next/navigation'

import { AgentBuilderWorkbench } from '@/components/agent-ops/agent-builder-workbench'
import { AGENT_BUILDER_SLUG } from '@/lib/agent-mission-control/agent-builder-copilot'
import { getCopilot } from '@/lib/agent-mission-control/data'

/**
 * /admin/agents/[id]/builder — the Agent Builder workbench.
 *
 * This surface is meaningful ONLY for the Agent Builder Copilot (the meta
 * copilot whose job is to draft OTHER copilots). For any other copilot the
 * route 404s — a normal copilot has no builder flow. The copilot is resolved
 * by id (the layout already loaded it), and gated on its stable slug.
 */
export default async function BuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const copilot = await getCopilot(id)
  if (!copilot || copilot.slug !== AGENT_BUILDER_SLUG) notFound()

  return <AgentBuilderWorkbench />
}
