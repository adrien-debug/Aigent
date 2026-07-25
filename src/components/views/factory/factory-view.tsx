import { EmptyStatePanel, NotMeasuredDash } from '@/components/agent-ops/empty-state'
import { CertifiedToolsPanel } from '@/components/agent-ops/factory/certified-tools-panel'
import { RuntimesPanel } from '@/components/agent-ops/factory/runtimes-panel'
import { SoftAccentLink } from '@/components/agent-ops/soft-accent-link'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { PageHeader } from '@/components/shell/page-header'
import { PageLayout } from '@/components/shell/page-layout'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import type { FactoryPageData } from '@/lib/agent-mission-control/factory-page-data'

export function FactoryView({ runtimes, certifiedTools, agentDraftCount, registryHash }: FactoryPageData) {
  return (
    <PageLayout className="gap-8 pb-12">
      <StaggerFade delay={1}>
        <PageHeader
          eyebrow="Factory"
          title="Factory"
          description="Build agents from certified tools. One registry, one truth."
          actions={
            <div className="flex items-center gap-3">
              <SoftAccentLink href="/admin/factory/tools">Build a tool</SoftAccentLink>
              <Button color="accent" href="/admin/agents/new">
                Create an agent
              </Button>
            </div>
          }
        />
      </StaggerFade>

      <StaggerFade delay={2}>
        <Section
          title="Certified tools"
          description="Tools the registry currently certifies as mountable."
          actions={<Text className="font-mono text-xs text-zinc-500">{certifiedTools.length} certified</Text>}
        >
          <CertifiedToolsPanel tools={certifiedTools} />
        </Section>
      </StaggerFade>

      <StaggerFade delay={3}>
        <Section title="Runtimes" description="Execution engines the registry knows about, and whether each is actually wired.">
          <RuntimesPanel runtimes={runtimes} />
        </Section>
      </StaggerFade>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <StaggerFade delay={4}>
          <Section
            title="Agent drafts"
            actions={
              <Text className="font-mono text-xs text-zinc-500">
                {agentDraftCount === null ? <NotMeasuredDash /> : agentDraftCount}
              </Text>
            }
          >
            <EmptyStatePanel
              className="border-0 bg-transparent"
              title="No drafts yet"
              description="Agent drafts created from the Factory will appear here."
            />
          </Section>
        </StaggerFade>

        <StaggerFade delay={5}>
          <Section
            title="Tool build missions"
            actions={
              <Text className="font-mono text-xs text-zinc-500">
                {/* No tool-build-mission store exists yet (next brick). Never
                    borrow the tools-table count here — that would read as
                    "33 missions" when there are none. Honest dash. */}
                <NotMeasuredDash />
              </Text>
            }
          >
            <EmptyStatePanel
              className="border-0 bg-transparent"
              title="No tool build missions"
              description="Tool build missions started from the Factory will appear here."
            />
          </Section>
        </StaggerFade>

        <StaggerFade delay={6}>
          <Section title="Missing capabilities">
            <EmptyStatePanel
              className="border-0 bg-transparent"
              title="No missing capabilities reported"
              description="Gaps between what agents request and what the registry can mount will surface here."
            />
          </Section>
        </StaggerFade>

        <StaggerFade delay={7}>
          <Section title="Blockers requiring human action">
            <EmptyStatePanel
              className="border-0 bg-transparent"
              title="No blockers"
              description="Anything the Factory cannot resolve on its own will appear here for review."
            />
          </Section>
        </StaggerFade>
      </div>

      <StaggerFade delay={8}>
        <div className="pt-3">
          <Text className="font-mono text-[11px] text-zinc-500">Registry {registryHash}</Text>
        </div>
      </StaggerFade>
    </PageLayout>
  )
}
