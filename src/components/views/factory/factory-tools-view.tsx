import { EmptyState } from '@/components/agent-ops/empty-state'
import { CertifiedToolsPanel, type FactoryToolRow } from '@/components/agent-ops/factory/certified-tools-panel'
import { SoftAccentLink } from '@/components/agent-ops/soft-accent-link'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { PageHeader } from '@/components/shell/page-header'
import { PageLayout } from '@/components/shell/page-layout'
import { Section } from '@/components/ui/section'

/**
 * /admin/factory/tools — the Tool Builder's STATUS screen.
 *
 * It used to publish the exact same header as /admin/factory/tools/new ("Build a
 * tool", eyebrow "Factory"), so the two screens were indistinguishable from
 * their titles and the CTA between them looked like a no-op. They now say what
 * each one is: this one reports builds and what the registry certifies, the
 * other documents the pipeline. The CTA is named after the destination it
 * actually reaches — a documentation page — because no UI can start a build yet;
 * "New tool build" promised an action that does not exist anywhere in this app.
 */
export function FactoryToolsView({ certifiedTools }: { certifiedTools: FactoryToolRow[] }) {
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
        <Section title="Builds in progress">
          <EmptyState
            title="No tool in progress"
            description="Nothing is being built right now. Builds walk DRAFT → IMPLEMENTING → TESTING → CERTIFIED, and are started outside this screen."
            action={<SoftAccentLink href="/admin/factory/tools/new">How a tool build works</SoftAccentLink>}
          />
        </Section>
      </StaggerFade>

      <StaggerFade delay={3}>
        <Section title="What exists today" description="Certified tools already mountable by every langgraph agent.">
          <CertifiedToolsPanel tools={certifiedTools} />
        </Section>
      </StaggerFade>
    </PageLayout>
  )
}
