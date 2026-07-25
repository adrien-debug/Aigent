import { EmptyStatePanel } from '@/components/agent-ops/empty-state'
import { CertifiedToolsPanel, type FactoryToolRow } from '@/components/agent-ops/factory/certified-tools-panel'
import { SoftAccentLink } from '@/components/agent-ops/soft-accent-link'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { PageHeader } from '@/components/shell/page-header'
import { PageLayout } from '@/components/shell/page-layout'
import { Section } from '@/components/ui/section'

export function FactoryToolsView({ certifiedTools }: { certifiedTools: FactoryToolRow[] }) {
  return (
    <PageLayout className="gap-8 pb-12">
      <StaggerFade delay={1}>
        <PageHeader eyebrow="Factory" title="Build a tool" description="Compose a new registry tool from scratch." />
      </StaggerFade>

      <StaggerFade delay={2}>
        <Section title="Tool Builder">
          <EmptyStatePanel
            className="border-0 bg-transparent"
            title="No tool in progress"
            description="Start a new build to walk the DRAFT → IMPLEMENTING → TESTING → CERTIFIED pipeline. Below is what the registry already certifies."
            action={<SoftAccentLink href="/admin/factory/tools/new">New tool build</SoftAccentLink>}
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
