import type { Metadata } from 'next'

import { AdminPageHeader, SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { EmptyStatePanel } from '@/components/agent-ops/empty-state'
import { CertifiedToolsPanel, type FactoryToolRow } from '@/components/agent-ops/factory/certified-tools-panel'
import { TOOL_IDS, getTool } from '@/lib/agent-mission-control/registry'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Build a tool — Aigent',
}

export default function FactoryToolsPage() {
  const certifiedTools: FactoryToolRow[] = TOOL_IDS.map((id) => {
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
  }).filter((t) => t.certification === 'certified')

  return (
    <div className="flex flex-col gap-8 pb-12">
      <StaggerFade delay={1}>
        <AdminPageHeader
          eyebrow="Factory"
          title="Build a tool"
          description="Compose a new registry tool from scratch."
        />
      </StaggerFade>

      <StaggerFade delay={2}>
        <SurfaceCard>
          <SurfaceCardHeader title="Tool Builder" />
          <EmptyStatePanel
            className="border-0 bg-transparent"
            title="Tool Builder — coming in the next brick"
            description="The guided pipeline to draft, certify and mount a new tool is not wired yet. Below is what the registry already certifies."
          />
        </SurfaceCard>
      </StaggerFade>

      <StaggerFade delay={3}>
        <SurfaceCard>
          <SurfaceCardHeader
            title="What exists today"
            description="Certified tools already mountable by every langgraph agent."
          />
          <CertifiedToolsPanel tools={certifiedTools} />
        </SurfaceCard>
      </StaggerFade>
    </div>
  )
}
