import { EmptyState } from '@/components/agent-ops/empty-state'
import { CertifiedToolsPanel, type FactoryToolRow } from '@/components/agent-ops/factory/certified-tools-panel'
import { ToolBuildMissionsPanel } from '@/components/agent-ops/factory/tool-build-missions-panel'
import { ToolBuildStartForm } from '@/components/agent-ops/factory/tool-build-start-form'
import { SoftAccentLink } from '@/components/agent-ops/soft-accent-link'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { PageHeader } from '@/components/shell/page-header'
import { PageLayout } from '@/components/shell/page-layout'
import { Section } from '@/components/ui/section'

import type { ToolBuildMissionRow } from '@/lib/agent-mission-control/tool-build-missions-store'

/**
 * /admin/factory/tools — the Tool Builder's STATUS screen.
 *
 * Lists active builds, offers a minimal start form, and shows certified tools.
 */
export function FactoryToolsView({
  certifiedTools,
  activeMissions,
}: {
  certifiedTools: FactoryToolRow[]
  activeMissions: ToolBuildMissionRow[] | null
}) {
  return (
    <PageLayout className="gap-8 pb-12">
      <StaggerFade delay={1}>
        <PageHeader
          eyebrow="Factory"
          title="Tool Builder"
          description="Builds in progress, and the tools the registry already certifies."
        />
      </StaggerFade>

      <StaggerFade delay={2}>
        <Section title="Start a build">
          <ToolBuildStartForm />
        </Section>
      </StaggerFade>

      <StaggerFade delay={3}>
        <Section title="Builds in progress">
          {activeMissions === null ? (
            <EmptyState
              title="Builds unavailable"
              description="The mission store could not be reached. Check gpu1 connectivity."
            />
          ) : activeMissions.length === 0 ? (
            <EmptyState
              title="No tool in progress"
              description="Nothing is being built right now."
              action={<SoftAccentLink href="/admin/factory/tools/new">How a tool build works</SoftAccentLink>}
            />
          ) : (
            <ToolBuildMissionsPanel missions={activeMissions} />
          )}
        </Section>
      </StaggerFade>

      <StaggerFade delay={4}>
        <Section title="What exists today" description="Certified tools already mountable by every langgraph agent.">
          <CertifiedToolsPanel tools={certifiedTools} />
        </Section>
      </StaggerFade>
    </PageLayout>
  )
}
