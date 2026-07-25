import { WrenchScrewdriverIcon } from '@heroicons/react/24/outline'

import { AgentBuilderWorkbench } from '@/components/agent-ops/agent-builder-workbench'
import { EmptyStatePanel } from '@/components/agent-ops/empty-state'
import { PageLayout } from '@/components/shell/page-layout'
import { Button } from '@/components/ui/button'
import type { Copilot } from '@/lib/agent-mission-control/types'

/**
 * /admin/agents/[id]/builder — the Agent Builder workbench.
 *
 * Meaningful ONLY for the Agent Builder Copilot (the meta copilot whose job
 * is to draft OTHER copilots). A normal copilot renders the "no builder for
 * this agent" empty state instead of a false 404 (AIGENT-UI-TRUTH-026) — see
 * `page.tsx` for the full history of that fix.
 */
export function AgentBuilderView({ copilot, isBuilderAgent }: { copilot: Copilot; isBuilderAgent: boolean }) {
  if (!isBuilderAgent) {
    return (
      <PageLayout>
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
      </PageLayout>
    )
  }

  return (
    <PageLayout>
      <AgentBuilderWorkbench />
    </PageLayout>
  )
}
