import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'

import { AgentKpiBand, type AgentKpiStat } from '@/components/agent-ops/agent-kpi-band'
import type { DashboardKpis } from '@/lib/agent-mission-control/dashboard-overview'

function formatKpi(value: number | null, suffix?: string): string {
  if (value === null) return '—'
  return suffix ? `${value}${suffix}` : String(value)
}

/**
 * Command-center KPI strip — one hero anchor against three calm metrics.
 * A single operator signal is escalated to hero size + accent (ready for
 * manual test if any, else blocked deliveries, else production agents as a
 * neutral fallback). Every other metric reads white or recedes to muted —
 * never a second accent. RepoFit folds into the Sandbox Pass Rate hint;
 * warnings drop to the card footer (DashboardDataWarnings).
 */
export function DashboardKpiStrip({ kpis }: { kpis: DashboardKpis }) {
  const anchor: 'ready' | 'blocked' | 'production' =
    kpis.readyForManualTest && kpis.readyForManualTest > 0
      ? 'ready'
      : kpis.blockedDeliveries && kpis.blockedDeliveries > 0
        ? 'blocked'
        : 'production'

  const stats: AgentKpiStat[] = [
    {
      name: 'Production Agents',
      value: formatKpi(kpis.productionAgents),
      valueSize: anchor === 'production' ? 'hero' : 'compact',
      valueTone: kpis.productionAgents === null ? 'muted' : 'default',
      hint: kpis.productionAgents === null ? undefined : 'with a live production version',
    },
    {
      name: 'Ready for Manual Test',
      value: formatKpi(kpis.readyForManualTest),
      valueSize: anchor === 'ready' ? 'hero' : 'compact',
      valueTone: anchor === 'ready' ? 'accent' : 'muted',
      hint: kpis.readyForManualTest ? 'awaiting operator sign-off' : undefined,
    },
    {
      name: 'Sandbox Pass Rate',
      value: kpis.sandboxPassRate === null ? '—' : formatKpi(kpis.sandboxPassRate),
      suffix: kpis.sandboxPassRate === null ? undefined : '%',
      valueSize: 'compact',
      valueTone: kpis.sandboxPassRate === null ? 'muted' : 'default',
      hint: kpis.avgRepoFit === null ? undefined : `RepoFit ${kpis.avgRepoFit}/100`,
    },
    {
      name: 'Blocked Deliveries',
      value: formatKpi(kpis.blockedDeliveries),
      valueSize: anchor === 'blocked' ? 'hero' : 'compact',
      valueTone:
        anchor === 'blocked'
          ? 'accent'
          : kpis.blockedDeliveries && kpis.blockedDeliveries > 0
            ? 'default'
            : 'muted',
      hint: kpis.blockedDeliveries && kpis.blockedDeliveries > 0 ? 'see Requires Attention' : undefined,
    },
  ]

  // `separators`, not `flush`: the four KPIs read as ONE synthesis band with
  // hairline dividers. Flush left them as bare text floating on the page with
  // no surface of their own (§4).
  return <AgentKpiBand stats={stats} separators />
}

/** Data-integrity note — a quiet hairline footer, never a full-width banner. */
export function DashboardDataWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null
  return (
    <div className="flex items-start gap-2 border-b border-zinc-950/5 pb-3">
      <ExclamationTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-600" />
      <ul className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
        {warnings.map((w) => (
          <li key={w} className="font-mono">{w}</li>
        ))}
      </ul>
    </div>
  )
}
