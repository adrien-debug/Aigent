import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'

import { AgentKpiBand, type AgentKpiStat } from '@/components/agent-ops/agent-kpi-band'
import type { DashboardKpis } from '@/lib/agent-mission-control/dashboard-overview'

function formatKpi(value: number | null, suffix?: string): string {
  if (value === null) return '—'
  return suffix ? `${value}${suffix}` : String(value)
}

/**
 * Command-center KPI strip — hero values on hairline-separated cells.
 * Tone discipline: accent is reserved for the two operator signals
 * (ready for manual test > 0, blocked > 0); metrics read white and
 * recede to muted when absent (—) or when the signal count is zero.
 * Hints carry the exact semantics of each aggregate — nothing invented.
 */
export function DashboardKpiStrip({ kpis }: { kpis: DashboardKpis }) {
  const stats: AgentKpiStat[] = [
    {
      name: 'Production Agents',
      value: formatKpi(kpis.productionAgents),
      valueTone: kpis.productionAgents === null ? 'muted' : 'default',
      hint: kpis.productionAgents === null ? undefined : 'with a live production version',
    },
    {
      name: 'Ready for Manual Test',
      value: formatKpi(kpis.readyForManualTest),
      valueTone: kpis.readyForManualTest ? 'accent' : 'muted',
      hint: kpis.readyForManualTest ? 'awaiting operator sign-off' : undefined,
    },
    {
      name: 'Sandbox Pass Rate',
      value: kpis.sandboxPassRate === null ? '—' : formatKpi(kpis.sandboxPassRate),
      suffix: kpis.sandboxPassRate === null ? undefined : '%',
      valueTone: kpis.sandboxPassRate === null ? 'muted' : 'default',
      hint: kpis.sandboxPassRate === null ? undefined : 'latest sandbox run per agent',
    },
    {
      name: 'Avg RepoFit',
      value: formatKpi(kpis.avgRepoFit),
      suffix: kpis.avgRepoFit === null ? undefined : '/100',
      valueTone: kpis.avgRepoFit === null ? 'muted' : 'default',
      hint: kpis.avgRepoFit === null ? undefined : 'mean across scored deliveries',
    },
    {
      name: 'Blocked Deliveries',
      value: formatKpi(kpis.blockedDeliveries),
      valueTone: kpis.blockedDeliveries && kpis.blockedDeliveries > 0 ? 'accent' : 'muted',
      hint: kpis.blockedDeliveries && kpis.blockedDeliveries > 0 ? 'see Requires Attention' : undefined,
    },
  ]

  return <AgentKpiBand stats={stats} separators />
}

export function DashboardHeader() {
  return (
    <div className="border-b border-white/5 bg-black/20 px-6 py-6 lg:px-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Dashboard</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight text-white sm:text-4xl">Agent Delivery Command Center</h1>
    </div>
  )
}

export function DashboardDataWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null
  return (
    <div className="flex items-start gap-2.5 border-b border-white/5 bg-black/20 px-6 py-3 lg:px-8">
      <ExclamationTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-400" />
      <ul className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
        {warnings.map((w) => (
          <li key={w} className="font-mono">{w}</li>
        ))}
      </ul>
    </div>
  )
}
