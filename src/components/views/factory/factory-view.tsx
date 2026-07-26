import { EmptyState, NotMeasuredDash } from '@/components/agent-ops/empty-state'
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

/**
 * Meta counter of a section header.
 *
 * `text-xs!` and not `text-xs`: `Text` composes `clsx(className, defaults)`, so a
 * bare `text-xs` loses to the primitive's own `sm:text-sm/6` in the compiled
 * sheet and every one of these counters actually rendered at 14px from 640px up.
 * `Text` exposes no size prop, and this file may not touch the primitive, so the
 * override is made real with an explicit `!` — visible in the diff, unlike the
 * no-op it replaces. The colour is dropped entirely: the primitive's own default
 * already IS zinc-500/zinc-400, so restating it only invited the reader to
 * believe a colour decision was being made here.
 */
function SectionCount({ children }: { children: React.ReactNode }) {
  return <Text className="font-mono text-xs!">{children}</Text>
}

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
              {/* Names the screen it opens ("Tool Builder"), not an action it does
                  not perform: /admin/factory/tools is a status screen, and the
                  build itself has no UI entry point yet. */}
              <SoftAccentLink href="/admin/factory/tools">Tool Builder</SoftAccentLink>
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
          actions={<SectionCount>{certifiedTools.length} certified</SectionCount>}
        >
          <CertifiedToolsPanel tools={certifiedTools} />
        </Section>
      </StaggerFade>

      <StaggerFade delay={3}>
        <Section title="Runtimes" description="Execution engines the registry knows about, and whether each is actually wired.">
          <RuntimesPanel runtimes={runtimes} />
        </Section>
      </StaggerFade>

      {/* Four sections, four empty states of DIFFERENT sentence lengths: their
          natural heights only agreed at 1440px by chance (232/232 there, 256/256
          at 1100px — measured), and one extra word in any description would have
          broken the row. `h-full` on the animated cell AND on the section makes
          the fill structural instead of accidental: grid stretching stops at the
          motion wrapper, the section inside it stays auto-height without it. */}
      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
        <StaggerFade className="h-full" delay={4}>
          <Section
            className="h-full"
            title="Agent drafts"
            actions={
              <SectionCount>{agentDraftCount === null ? <NotMeasuredDash /> : agentDraftCount}</SectionCount>
            }
          >
            <EmptyState
              title="No drafts yet"
              description="Agent drafts created from the Factory will appear here."
            />
          </Section>
        </StaggerFade>

        <StaggerFade className="h-full" delay={5}>
          <Section
            className="h-full"
            title="Tool build missions"
            actions={
              <SectionCount>
                {/* No tool-build-mission store exists yet (next brick). Never
                    borrow the tools-table count here — that would read as
                    "33 missions" when there are none. Honest dash. */}
                <NotMeasuredDash />
              </SectionCount>
            }
          >
            <EmptyState
              title="No tool build missions"
              description="Tool build missions started from the Factory will appear here."
            />
          </Section>
        </StaggerFade>

        <StaggerFade className="h-full" delay={6}>
          <Section className="h-full" title="Missing capabilities">
            <EmptyState
              title="No missing capabilities reported"
              description="Gaps between what agents request and what the registry can mount will surface here."
            />
          </Section>
        </StaggerFade>

        <StaggerFade className="h-full" delay={7}>
          <Section className="h-full" title="Blockers requiring human action">
            <EmptyState
              title="No blockers"
              description="Anything the Factory cannot resolve on its own will appear here for review."
            />
          </Section>
        </StaggerFade>
      </div>

      <StaggerFade delay={8}>
        <div className="pt-3">
          {/* Was `text-[11px]`, dead against the primitive's `sm:text-sm/6` and
              therefore rendering at 14px. Revived on the documented meta step
              (`text-xs`) rather than on an off-scale 11px nobody else uses. */}
          <Text className="font-mono text-xs!">Registry {registryHash}</Text>
        </div>
      </StaggerFade>
    </PageLayout>
  )
}
