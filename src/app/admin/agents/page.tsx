import type { Metadata } from 'next'
import { PlusIcon } from '@heroicons/react/16/solid'

import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { AgentPageHeader } from '@/components/agent-ops/agent-page-header'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { ProvisionAgentBuilderBanner } from '@/components/agent-ops/provision-agent-builder-banner'
import { RegistryView } from '@/components/agent-ops/registry-view'
import { AGENT_BUILDER_SLUG } from '@/lib/agent-mission-control/agent-builder-copilot'
import { formatPercent, formatUsd } from '@/lib/agent-mission-control/format'
import {
  getCopilots,
  getProjects,
  getRecentWarnings,
  getRegistryKpis,
} from '@/lib/agent-mission-control/data'
import { Link } from '@/components/catalyst/link'

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
  const [copilots, projects, kpis, warnings] = await Promise.all([
    getCopilots(),
    getProjects(),
    getRegistryKpis(),
    getRecentWarnings(6),
  ])
  const onBenchCount = copilots.filter((copilot) => copilot.projectId === null).length
  const assignedCount = copilots.length - onBenchCount
  const hasAgentBuilder = copilots.some((copilot) => copilot.slug === AGENT_BUILDER_SLUG)

  const copilotNameById = new Map(copilots.map((copilot) => [copilot.id, copilot.name]))

  return (
    <div className="flex flex-col gap-8 pb-12">
      <StaggerFade delay={0}>
        <AgentPageHeader 
          title="Copilots Registry" 
          description="Central repository of all agents, their capabilities, and validation status."
          breadcrumbs={[
            { label: 'Platform', href: '/admin' },
            { label: 'Copilots' }
          ]}
          actions={
            <Link 
              href="/admin/agents/new" 
              className="inline-flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow-[0_0_16px_rgba(99,102,241,0.4)] transition-all hover:bg-accent-400 hover:shadow-[0_0_24px_rgba(99,102,241,0.6)]"
            >
              <PlusIcon className="size-4" />
              New Copilot
            </Link>
          }
        />
      </StaggerFade>

      {hasAgentBuilder ? null : (
        <StaggerFade delay={1}>
          <ProvisionAgentBuilderBanner />
        </StaggerFade>
      )}

      <StaggerFade delay={2}>
        <AgentKpiBand
          stats={[
            { name: 'Total Fleet', value: String(kpis.totalCopilots) },
            {
              name: 'Distribution',
              content: (
                <div className="flex flex-col gap-1 mt-1">
                  <div className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-accent-500" />
                    <span className="text-sm text-zinc-300">{assignedCount} Assigned</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-zinc-600" />
                    <span className="text-sm text-zinc-300">{onBenchCount} On Bench</span>
                  </div>
                </div>
              ),
            },
            { name: 'Avg Test Pass', value: formatPercent(kpis.avgTestPassRate), valueTone: 'accent' },
            { name: '24h Compute', value: formatUsd(kpis.totalCostLast24hUsd) },
            {
              name: 'Active Warnings',
              value: String(kpis.openWarnings),
              valueTone: kpis.openWarnings > 0 ? 'accent' : 'muted',
            },
          ]}
        />
      </StaggerFade>

      <StaggerFade delay={3}>
        <RecentWarningsCard warnings={warnings} copilotNameById={copilotNameById} />
      </StaggerFade>

      <StaggerFade delay={4}>
        <RegistryView
          copilots={copilots}
          projects={projects}
          warnings={warnings}
        />
      </StaggerFade>
    </div>
  )
}
