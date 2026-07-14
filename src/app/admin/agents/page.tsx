import type { Metadata } from 'next'
import { PlusIcon } from '@heroicons/react/16/solid'

import { AgentPageHeader } from '@/components/agent-ops/agent-page-header'
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
    <div className="rounded-2xl bg-[var(--color-surface-secondary)] border border-white/5 overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-white/5 bg-black/20">
        <h2 className="text-sm font-semibold text-white">Recent warnings</h2>
        {warnings.length > 0 && (
          <span className="text-xs text-zinc-400">
            {warningCount} warning{warningCount === 1 ? '' : 's'} · {dangerCount} danger
          </span>
        )}
      </div>
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
    </div>
  )
}

interface KpiBandProps {
  kpis: {
    totalCopilots: number
    avgTestPassRate: number
    totalCostLast24hUsd: number
    openWarnings: number
  }
  benchCount: number
  assignedCount: number
}

function KpiBand({ kpis, benchCount, assignedCount }: KpiBandProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-8 py-6 border-b border-white/5 mb-8">
      <div className="flex flex-col">
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">Total Fleet</span>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-light tracking-tight text-white">{kpis.totalCopilots}</span>
        </div>
      </div>
      <div className="flex flex-col">
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">Distribution</span>
        <div className="flex flex-col gap-1 mt-1">
          <div className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-accent-500"></span>
            <span className="text-sm text-zinc-300">{assignedCount} Assigned</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-zinc-600"></span>
            <span className="text-sm text-zinc-300">{benchCount} On Bench</span>
          </div>
        </div>
      </div>
      <div className="flex flex-col">
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">Avg Test Pass</span>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-light tracking-tight text-accent-400">{formatPercent(kpis.avgTestPassRate)}</span>
        </div>
      </div>
      <div className="flex flex-col">
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">24h Compute</span>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-light tracking-tight text-white">{formatUsd(kpis.totalCostLast24hUsd)}</span>
        </div>
      </div>
      <div className="flex flex-col">
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">Active Warnings</span>
        <div className="flex items-baseline gap-2">
          <span className={`text-4xl font-light tracking-tight ${kpis.openWarnings > 0 ? 'text-accent-400' : 'text-zinc-500'}`}>{kpis.openWarnings}</span>
        </div>
      </div>
    </div>
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
        <KpiBand kpis={kpis} benchCount={onBenchCount} assignedCount={assignedCount} />
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
