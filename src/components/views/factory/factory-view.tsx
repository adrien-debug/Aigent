import { EmptyState, NotMeasuredDash } from '@/components/agent-ops/empty-state'
import { AgentDraftsPanel } from '@/components/agent-ops/factory/agent-drafts-panel'
import { CertifiedToolsPanel } from '@/components/agent-ops/factory/certified-tools-panel'
import { ToolBuildMissionsPanel } from '@/components/agent-ops/factory/tool-build-missions-panel'
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
 * Plain `text-xs`, no `!`. The escape hatch was posted when `Text` composed
 * `clsx(className, defaults)` — the caller's class was emitted before the
 * primitive's `sm:text-sm/6`, lost the cascade, and every counter rendered at
 * 14px from 640px up. `Text` now composes `cn(defaults, className)`, so
 * `tailwind-merge` drops the losing default in JS and the bare class wins on
 * its own.
 *
 * The `!` is not merely redundant now, it is ACTIVELY WORSE: `tailwind-merge`
 * v3 keys its conflict groups on the important flag, so `text-xs!` does NOT
 * merge with `text-sm/6` (verified: `twMerge('text-sm/6','text-xs!')` returns
 * BOTH). The dead default therefore stayed in the class list, `responsiveDefault`
 * still emitted its `max-sm:` half, and the only thing making the size correct
 * was `!important` — which no downstream caller could then override. Bare
 * `text-xs` measures identically at 1440/768/390 (12px/16px) with a class list
 * of three utilities instead of six.
 *
 * The colour is dropped entirely: the primitive's own default already IS
 * zinc-500/zinc-400, so restating it only invited the reader to believe a
 * colour decision was being made here.
 */
function SectionCount({ children }: { children: React.ReactNode }) {
  return <Text className="font-mono text-xs">{children}</Text>
}

export function FactoryView({
  runtimes,
  certifiedTools,
  agentDraftCount,
  agentDrafts,
  toolBuildMissions,
  registryHash,
}: FactoryPageData) {
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
            {agentDrafts === null ? (
              <EmptyState
                title="Drafts unavailable"
                description="The agent drafts store could not be reached. Check gpu1 connectivity."
              />
            ) : (
              <AgentDraftsPanel drafts={agentDrafts} />
            )}
          </Section>
        </StaggerFade>

        <StaggerFade className="h-full" delay={5}>
          <Section
            className="h-full"
            title="Tool build missions"
            actions={
              <SectionCount>
                {toolBuildMissions === null ? (
                  <NotMeasuredDash />
                ) : (
                  toolBuildMissions.length
                )}
              </SectionCount>
            }
          >
            {toolBuildMissions === null ? (
              <EmptyState
                title="Missions unavailable"
                description="The tool build mission store could not be reached."
              />
            ) : (
              <ToolBuildMissionsPanel missions={toolBuildMissions} />
            )}
          </Section>
        </StaggerFade>
      </div>

      <StaggerFade delay={8}>
        <div className="pt-3">
          {/* Was `text-[11px]`, dead against the primitive's `sm:text-sm/6` and
              therefore rendering at 14px. Revived on the documented meta step
              (`text-xs`) rather than on an off-scale 11px nobody else uses.
              No `!` — see `SectionCount` above for why it is now the thing that
              BLOCKS the merge instead of the thing that made the override land. */}
          <Text className="font-mono text-xs">Registry {registryHash}</Text>
        </div>
      </StaggerFade>
    </PageLayout>
  )
}
