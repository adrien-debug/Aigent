import type { Metadata } from 'next'
import { PlusIcon } from '@heroicons/react/16/solid'

import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { ProvisionAgentBuilderBanner } from '@/components/agent-ops/provision-agent-builder-banner'
import { RegistryView } from '@/components/agent-ops/registry-view'
import { AGENT_BUILDER_SLUG } from '@/lib/agent-mission-control/agent-builder-copilot'
import {
  getCopilots,
  getProjects,
  getRecentWarnings,
} from '@/lib/agent-mission-control/data'
import { Button } from '@/components/catalyst/button'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Copilots Registry — Aigent',
}

import { SeverityFeedRow } from '@/components/agent-ops/widgets/severity-feed-row'
import type { RegistryWarning } from '@/lib/agent-mission-control/types'

const REFERENCE_NOW_ISO = '2026-07-09T12:00:00Z'

function RecentWarningsCard({
  warnings,
  copilotNameById,
}: {
  warnings: RegistryWarning[]
  copilotNameById: Map<string, string>
}) {
  const warningCount = warnings.filter((w) => w.severity === 'warning').length
  const dangerCount = warnings.filter((w) => w.severity === 'danger').length

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Recent warnings"
        meta={
          warnings.length > 0 ? (
            <span className="text-xs text-zinc-400">
              {warningCount} warning{warningCount === 1 ? '' : 's'} · {dangerCount} danger
            </span>
          ) : undefined
        }
      />
      <div className="p-4">
        {warnings.length > 0 ? (
          <div role="list" className="divide-y divide-white/5">
            {warnings.map((warning) => (
              <div role="listitem" key={warning.id}>
                <SeverityFeedRow
                  severity={warning.severity}
                  message={warning.message}
                  copilotName={copilotNameById.get(warning.copilotId)}
                  occurredAt={warning.occurredAt}
                  referenceNow={REFERENCE_NOW_ISO}
                  href={warning.href}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="py-4 text-sm text-zinc-400">No open warnings. All copilots are healthy.</p>
        )}
      </div>
    </SurfaceCard>
  )
}

export default async function AgentsRegistryPage() {
  const [copilots, projects, warnings] = await Promise.all([
    getCopilots(),
    getProjects(),
    getRecentWarnings(6),
  ])
  const hasAgentBuilder = copilots.some((copilot) => copilot.slug === AGENT_BUILDER_SLUG)

  const copilotNameById = new Map(copilots.map((copilot) => [copilot.id, copilot.name]))

  return (
    <div className="flex flex-col gap-8 pb-12">
      {hasAgentBuilder ? null : (
        <StaggerFade delay={0}>
          <ProvisionAgentBuilderBanner />
        </StaggerFade>
      )}

      <StaggerFade delay={1}>
        <RegistryView
          copilots={copilots}
          projects={projects}
          action={
            <Button href="/admin/agents/new" color="accent">
              <PlusIcon data-slot="icon" />
              New Copilot
            </Button>
          }
        />
      </StaggerFade>

      <StaggerFade delay={2}>
        <RecentWarningsCard warnings={warnings} copilotNameById={copilotNameById} />
      </StaggerFade>
    </div>
  )
}
