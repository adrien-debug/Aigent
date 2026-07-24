import type { Metadata } from 'next'

import { AdminPageHeader, SurfaceCard, SurfaceCardHeader, surfaceCardFooterClass } from '@/components/agent-ops/surface-card'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { EmptyStatePanel, NotMeasuredDash } from '@/components/agent-ops/empty-state'
import { SoftAccentLink } from '@/components/agent-ops/soft-accent-link'
import { CertifiedToolsPanel, type FactoryToolRow } from '@/components/agent-ops/factory/certified-tools-panel'
import { RuntimesPanel, type FactoryRuntimeRow } from '@/components/agent-ops/factory/runtimes-panel'
import { Button } from '@/components/catalyst/button'
import { Text } from '@/components/catalyst/text'
import {
  REGISTRY_HASH,
  RUNTIME_IDS,
  TOOL_IDS,
  getRuntime,
  getTool,
} from '@/lib/agent-mission-control/registry'
import { isPgrestTimeout, pgrestWithCount } from '@/lib/agent-mission-control/postgrest'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Factory — Aigent',
}

async function getAgentDraftCount(): Promise<number | null> {
  try {
    const drafts = await pgrestWithCount('agent_drafts?select=id&limit=0')
    return drafts.count
  } catch (err) {
    // Fail-soft: a landing count must never take the page down. Null → dash.
    console.error('[admin/factory] draft count unavailable:', isPgrestTimeout(err) ? 'timeout' : err)
    return null
  }
}

export default async function FactoryPage() {
  const runtimes: FactoryRuntimeRow[] = RUNTIME_IDS.map((id) => {
    const r = getRuntime(id)!
    return {
      id: r.id,
      label: r.label,
      engine: r.engine,
      executable: r.engine !== 'none',
      creatable: r.creatable && r.engine !== 'none',
      capabilities: r.capabilities,
      note: r.note,
    }
  })

  const allTools: FactoryToolRow[] = TOOL_IDS.map((id) => {
    const t = getTool(id)!
    return {
      id: t.id,
      version: t.version,
      label: t.label,
      summary: t.summary,
      kind: t.kind,
      mutates: t.mutates,
      risk: t.risk,
      requiresConfirmation: t.requiresConfirmation,
      provenance: t.provenance,
      certification: t.certification,
    }
  })
  const certifiedTools = allTools.filter((t) => t.certification === 'certified')

  const agentDraftCount = await getAgentDraftCount()

  return (
    <div className="flex flex-col gap-8 pb-12">
      <StaggerFade delay={1}>
        <AdminPageHeader
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
        <SurfaceCard>
          <SurfaceCardHeader
            title="Certified tools"
            description="Tools the registry currently certifies as mountable."
            meta={<Text className="font-mono text-xs text-zinc-500">{certifiedTools.length} certified</Text>}
          />
          <CertifiedToolsPanel tools={certifiedTools} />
        </SurfaceCard>
      </StaggerFade>

      <StaggerFade delay={3}>
        <SurfaceCard>
          <SurfaceCardHeader
            title="Runtimes"
            description="Execution engines the registry knows about, and whether each is actually wired."
          />
          <RuntimesPanel runtimes={runtimes} />
        </SurfaceCard>
      </StaggerFade>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <StaggerFade delay={4}>
          <SurfaceCard>
            <SurfaceCardHeader
              title="Agent drafts"
              meta={
                <Text className="font-mono text-xs text-zinc-500">
                  {agentDraftCount === null ? <NotMeasuredDash /> : agentDraftCount}
                </Text>
              }
            />
            <EmptyStatePanel
              className="border-0 bg-transparent"
              title="No drafts yet"
              description="Agent drafts created from the Factory will appear here."
            />
          </SurfaceCard>
        </StaggerFade>

        <StaggerFade delay={5}>
          <SurfaceCard>
            <SurfaceCardHeader
              title="Tool build missions"
              meta={
                <Text className="font-mono text-xs text-zinc-500">
                  {/* No tool-build-mission store exists yet (next brick). Never
                      borrow the tools-table count here — that would read as
                      "33 missions" when there are none. Honest dash. */}
                  <NotMeasuredDash />
                </Text>
              }
            />
            <EmptyStatePanel
              className="border-0 bg-transparent"
              title="No tool build missions"
              description="Tool build missions started from the Factory will appear here."
            />
          </SurfaceCard>
        </StaggerFade>

        <StaggerFade delay={6}>
          <SurfaceCard>
            <SurfaceCardHeader title="Missing capabilities" />
            <EmptyStatePanel
              className="border-0 bg-transparent"
              title="No missing capabilities reported"
              description="Gaps between what agents request and what the registry can mount will surface here."
            />
          </SurfaceCard>
        </StaggerFade>

        <StaggerFade delay={7}>
          <SurfaceCard>
            <SurfaceCardHeader title="Blockers requiring human action" />
            <EmptyStatePanel
              className="border-0 bg-transparent"
              title="No blockers"
              description="Anything the Factory cannot resolve on its own will appear here for review."
            />
          </SurfaceCard>
        </StaggerFade>
      </div>

      <StaggerFade delay={8}>
        <div className={surfaceCardFooterClass}>
          <Text className="font-mono text-[11px] text-zinc-500">Registry {REGISTRY_HASH}</Text>
        </div>
      </StaggerFade>
    </div>
  )
}
