import { PlusIcon } from '@heroicons/react/16/solid'
import type { Metadata } from 'next'

import { AgentMetricCard } from '@/components/agent-ops/agent-metric-card'
import { AgentPageHeader } from '@/components/agent-ops/agent-page-header'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { RegistryView } from '@/components/agent-ops/registry-view'
import NextLink from 'next/link'

import { Button } from '@/components/catalyst/button'
import { formatPercent, formatRelative, formatUsd } from '@/lib/agent-mission-control/format'
import {
  getCopilots,
  getProjects,
  getRecentWarnings,
  getRegistryKpis,
} from '@/lib/agent-mission-control/data'
import type { RegistryWarning } from '@/lib/agent-mission-control/types'

export const metadata: Metadata = {
  title: 'Copilots — Agent Mission Control',
}

/** Fixed reference point matching the mock dataset window (no Date.now()). */
const REFERENCE_NOW_ISO = '2026-07-09T12:00:00Z'

const severityConfig: Record<
  RegistryWarning['severity'],
  { label: string; dotClassName: string; textClassName: string }
> = {
  warning: {
    label: 'Warning',
    dotClassName: 'bg-amber-500 dark:bg-amber-400',
    textClassName: 'text-amber-600 dark:text-amber-400',
  },
  danger: {
    label: 'Danger',
    dotClassName: 'bg-rose-500 dark:bg-rose-400',
    textClassName: 'text-rose-600 dark:text-rose-400',
  },
}

function RecentWarningsCard({
  warnings,
  copilotNameById,
}: {
  warnings: RegistryWarning[]
  copilotNameById: Map<string, string>
}) {
  return (
    <AgentSectionCard
      title="Recent warnings"
      description="Latest signals across the registry."
      contentClassName="px-6 py-2"
    >
      {warnings.length > 0 ? (
        <ul role="list" className="divide-y divide-zinc-950/5 dark:divide-white/5">
          {warnings.map((warning) => {
            const severity = severityConfig[warning.severity]
            const copilotName = copilotNameById.get(warning.copilotId)
            return (
              <li key={warning.id} className="flex gap-x-3 py-4">
                <span
                  aria-hidden="true"
                  className={`mt-2 size-1.5 shrink-0 rounded-full ${severity.dotClassName}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm/6 text-zinc-700 dark:text-zinc-300">{warning.message}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                    <span className={`font-medium ${severity.textClassName}`}>{severity.label}</span>
                    {copilotName ? (
                      <>
                        <span aria-hidden="true">&middot;</span>
                        <span>{copilotName}</span>
                      </>
                    ) : null}
                    <span aria-hidden="true">&middot;</span>
                    <time dateTime={warning.occurredAt}>{formatRelative(warning.occurredAt, REFERENCE_NOW_ISO)}</time>
                    <span aria-hidden="true">&middot;</span>
                    <NextLink
                      href={warning.href}
                      className="font-medium text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
                    >
                      Investigate
                      <span className="sr-only"> {copilotName ?? warning.copilotId} warning</span>
                    </NextLink>
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="py-4 text-sm text-zinc-500 dark:text-zinc-400">No open warnings. All copilots are healthy.</p>
      )}
    </AgentSectionCard>
  )
}

export default async function AgentsRegistryPage() {
  const [copilots, projects, kpis, warnings] = await Promise.all([
    getCopilots(),
    getProjects(),
    getRegistryKpis(),
    getRecentWarnings(6),
  ])
  const copilotNameById = new Map(copilots.map((copilot) => [copilot.id, copilot.name]))

  return (
    <div className="space-y-8">
      <AgentPageHeader
        title="Copilots"
        description="Registry of every copilot agent across projects — status, runtime, health and cost at a glance."
        actions={
          /* V1 stub — visibly inert until copilot creation ships. */
          <Button color="green" disabled title="Copilot creation ships in V2">
            <PlusIcon />
            New copilot
            <span className="sr-only"> (coming soon)</span>
          </Button>
        }
      />

      <section aria-label="Registry key metrics" className="grid gap-8 sm:grid-cols-2 xl:grid-cols-6">
        <AgentMetricCard label="Copilots" value={String(kpis.totalCopilots)} hint={`${kpis.activeCopilots} active`} />
        <AgentMetricCard label="Active" value={String(kpis.activeCopilots)} hint="Serving traffic" />
        <AgentMetricCard
          label="Avg test pass"
          value={formatPercent(kpis.avgTestPassRate)}
          hint="Measured copilots"
        />
        <AgentMetricCard label="Runs 24h" value={kpis.runsLast24h.toLocaleString('en-US')} hint="All projects" />
        <AgentMetricCard label="Cost 24h" value={formatUsd(kpis.totalCostLast24hUsd)} hint="Model + tools" />
        <AgentMetricCard
          label="Open warnings"
          value={String(kpis.openWarnings)}
          hint={kpis.openWarnings > 0 ? 'Needs attention' : 'All clear'}
        />
      </section>

      <RegistryView
        copilots={copilots}
        projects={projects}
        warningsSlot={<RecentWarningsCard warnings={warnings} copilotNameById={copilotNameById} />}
      />
    </div>
  )
}
