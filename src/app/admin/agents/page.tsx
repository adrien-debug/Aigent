import type { Metadata } from 'next'

import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { RegistryView } from '@/components/agent-ops/registry-view'
import { LinearMeter } from '@/components/agent-ops/widgets/linear-meter'
import { RadialMeter } from '@/components/agent-ops/widgets/radial-meter'
import { SeverityFeedRow, SeverityTally } from '@/components/agent-ops/widgets/severity-feed-row'
import { SplitBar } from '@/components/agent-ops/widgets/split-bar'
import { formatPercent, formatUsd } from '@/lib/agent-mission-control/format'
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
    <AgentSectionCard
      title="Recent warnings"
      description="Latest signals across the registry."
      actions={warnings.length > 0 ? <SeverityTally warning={warningCount} danger={dangerCount} /> : undefined}
      contentClassName="px-6 py-2"
    >
      {warnings.length > 0 ? (
        <div role="list" className="divide-y divide-zinc-950/5 dark:divide-white/5">
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
  const onBenchCount = copilots.filter((copilot) => copilot.projectId === null).length
  const assignedCount = copilots.length - onBenchCount

  return (
    <div className="space-y-8">
      {/* KPI en haut, marge au-dessus = petit header (directive Adrien 2026-07-10) */}
      <AgentKpiBand
        className="mt-2"
        stats={[
          {
            name: 'Fleet',
            value: String(kpis.totalCopilots),
            viz: (
              <SplitBar
                segments={[
                  { key: 'bench', label: 'On bench', value: onBenchCount, tone: 'zinc' },
                  { key: 'assigned', label: 'Assigned', value: assignedCount, tone: 'accent-500' },
                ]}
              />
            ),
          },
          {
            name: 'Active share',
            value: String(kpis.activeCopilots),
            viz: (
              <RadialMeter
                value={kpis.activeCopilots}
                max={Math.max(kpis.totalCopilots, 1)}
                size={64}
                strokeWidth={5}
                caption={`of ${kpis.totalCopilots}`}
                ariaLabel={`${kpis.activeCopilots} of ${kpis.totalCopilots} copilots active`}
              />
            ),
          },
          {
            name: 'Avg test pass',
            value: formatPercent(kpis.avgTestPassRate),
            viz: (
              <LinearMeter
                value={kpis.avgTestPassRate}
                valueText={formatPercent(kpis.avgTestPassRate)}
                ariaLabel="Average test pass rate"
              />
            ),
          },
          {
            name: 'Cost 24h',
            value: formatUsd(kpis.totalCostLast24hUsd),
            viz: (
              <LinearMeter
                value={Math.min(kpis.totalCostLast24hUsd, 100)}
                max={100}
                tone="zinc"
                valueText={formatUsd(kpis.totalCostLast24hUsd)}
                ariaLabel="Total cost in past 24 hours"
              />
            ),
          },
          {
            name: 'Warnings',
            value: String(kpis.openWarnings),
            viz: (
              <LinearMeter
                value={kpis.openWarnings}
                max={Math.max(kpis.totalCopilots, 1)}
                tone="accentSolid"
                valueText={`${kpis.openWarnings} open warning${kpis.openWarnings === 1 ? '' : 's'}`}
                ariaLabel="Open warnings across the fleet"
              />
            ),
          },
        ]}
      />

      <RegistryView
        copilots={copilots}
        projects={projects}
        warningsSlot={<RecentWarningsCard warnings={warnings} copilotNameById={copilotNameById} />}
      />
    </div>
  )
}
