import { AgentKpiBand, type AgentKpiStat } from '@/components/agent-ops/agent-kpi-band'
import type { DashboardKpis } from '@/lib/agent-mission-control/dashboard-overview'

function formatKpi(value: number | null, suffix?: string): string {
  if (value === null) return '—'
  return suffix ? `${value}${suffix}` : String(value)
}

export function DashboardKpiStrip({ kpis }: { kpis: DashboardKpis }) {
  const stats: AgentKpiStat[] = [
    { name: 'Production Agents', value: formatKpi(kpis.productionAgents), valueTone: 'accent' },
    { name: 'Ready for Manual Test', value: formatKpi(kpis.readyForManualTest), valueTone: kpis.readyForManualTest ? 'accent' : 'muted' },
    {
      name: 'Sandbox Pass Rate',
      value: kpis.sandboxPassRate === null ? '—' : formatKpi(kpis.sandboxPassRate),
      suffix: kpis.sandboxPassRate === null ? undefined : '%',
      valueTone: kpis.sandboxPassRate !== null && kpis.sandboxPassRate >= 90 ? 'accent' : 'default',
    },
    { name: 'Avg RepoFit', value: formatKpi(kpis.avgRepoFit), suffix: kpis.avgRepoFit === null ? undefined : '/100' },
    {
      name: 'Blocked Deliveries',
      value: formatKpi(kpis.blockedDeliveries),
      valueTone: kpis.blockedDeliveries && kpis.blockedDeliveries > 0 ? 'accent' : 'muted',
    },
  ]

  return <AgentKpiBand stats={stats} className="px-6 lg:px-8" />
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
    <div className="mx-6 mb-0 rounded-lg border border-white/10 bg-black/30 px-4 py-3 lg:mx-8">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
        {warnings.map((w) => (
          <li key={w} className="font-mono">{w}</li>
        ))}
      </ul>
    </div>
  )
}
