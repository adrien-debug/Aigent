import { WrenchScrewdriverIcon } from '@heroicons/react/24/outline'
import { notFound } from 'next/navigation'

import { AgentBuilderWorkbench } from '@/components/agent-ops/agent-builder-workbench'
import { EmptyStatePanel } from '@/components/agent-ops/empty-state'
import { Button } from '@/components/catalyst/button'
import { AGENT_BUILDER_SLUG } from '@/lib/agent-mission-control/agent-builder-copilot'
import { getCopilot } from '@/lib/agent-mission-control/data'

/**
 * /admin/agents/[id]/builder — the Agent Builder workbench.
 *
 * This surface is meaningful ONLY for the Agent Builder Copilot (the meta
 * copilot whose job is to draft OTHER copilots). A normal copilot has no
 * builder flow.
 *
 * TRUTH FIX (AIGENT-UI-TRUTH-026). This page used to answer BOTH causes with a
 * single `notFound()`:
 *
 *   if (!copilot || copilot.slug !== AGENT_BUILDER_SLUG) notFound()
 *
 * so an agent that exists and is `active` was told "Error 404 — Copilot not
 * found / No copilot with this id exists in the registry" (agents/not-found.tsx).
 * That message is false for the second cause, and it is the ONLY cause that can
 * actually reach this file: the section layout ([id]/layout.tsx) already
 * resolves the agent and 404s when it is absent, so `!copilot` here is pure
 * defence-in-depth. The two causes now render two different things.
 *
 * The route is reachable by direct URL only — the agent section nav
 * (agent-detail-nav.tsx) has six tabs and `builder` is not one of them, and no
 * link in `src/` targets it (the linked builders are the PROJECT ones,
 * /admin/projects/[id]/builder). Deleting it, and the 458-line
 * agent-builder-workbench.tsx whose only consumer it is, is the better end
 * state; that is an integrator call because it touches files outside this pass.
 */
export default async function BuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const copilot = await getCopilot(id)

  // Cause 1 — the agent really does not exist. A 404 is the truthful answer,
  // and agents/not-found.tsx says exactly that.
  if (!copilot) notFound()

  // Cause 2 — the agent exists; this surface simply does not apply to it. It is
  // not a missing resource, so it must not claim to be one.
  if (copilot.slug !== AGENT_BUILDER_SLUG) {
    return (
      <EmptyStatePanel
        icon={WrenchScrewdriverIcon}
        title="No builder for this agent"
        description={`The builder workbench belongs to the Agent Builder Copilot, the meta-agent that drafts other agents. ${copilot.name} is a regular agent, so it has no builder flow.`}
        action={
          <>
            <Button href={`/admin/agents/${copilot.id}`}>Back to agent</Button>
            {copilot.projectId ? (
              <Button outline href={`/admin/projects/${copilot.projectId}/builder`}>
                Project Agent Builder
              </Button>
            ) : null}
          </>
        }
      />
    )
  }

  return <AgentBuilderWorkbench />
}
