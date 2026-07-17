import { EmptyState } from '@/components/agent-ops/empty-state'
import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { surfaceCardClass, surfaceCardHeaderClass } from '@/components/agent-ops/surface-card'
import { CubeTransparentIcon } from '@heroicons/react/24/outline'

import type { RosterSummary, TradingAgentVM } from './roster-view-model'
import { TradingAgentRow } from './trading-agent-row'

/**
 * Trading Agent Factory roster — the gamme of six trading copilots as ONE
 * dense SurfaceCard: a KPI strip (naked stats on a hairline, no box) over a
 * hairline-separated list of agent rows (no mur de cards). Empty ROSTER →
 * the canon EmptyState.
 */
export function TradingRoster({
  agents,
  summary,
}: {
  agents: TradingAgentVM[]
  summary: RosterSummary
}) {
  if (agents.length === 0) {
    return (
      <div className={surfaceCardClass}>
        <EmptyState
          icon={CubeTransparentIcon}
          title="No trading agents defined"
          description="The trading gamme roster is empty — no agent definitions are registered in the market roster."
        />
      </div>
    )
  }

  return (
    <div className={surfaceCardClass}>
      <div className={`${surfaceCardHeaderClass} px-6 py-4 lg:px-8`}>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white">Roster</h2>
          <p className="mt-1 text-xs text-zinc-400">
            Six read-only ETH copilots, each owning one structured output contract. None is
            materialized yet — every agent is Experimental.
          </p>
        </div>
      </div>

      <AgentKpiBand
        separators
        density="compact"
        stats={[
          { name: 'Agents', value: String(summary.agentCount), valueSize: 'compact' },
          { name: 'Output contracts', value: String(summary.contractCount), valueSize: 'compact' },
          {
            name: 'Tool bindings',
            value: String(summary.availableToolReferences),
            valueSize: 'compact',
            hint: `${summary.unavailableToolReferences} unavailable`,
          },
          {
            name: 'Materialized',
            value: '0',
            valueSize: 'compact',
            valueTone: 'muted',
            hint: `of ${summary.agentCount}`,
          },
        ]}
      />

      <div role="list">
        {agents.map((agent, index) => (
          <div role="listitem" key={agent.slug}>
            <TradingAgentRow agent={agent} index={index} />
          </div>
        ))}
      </div>
    </div>
  )
}
