import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'

import { AgentKpiBand, type AgentKpiStat } from '@/components/agent-ops/agent-kpi-band'
import type { DashboardKpis } from '@/lib/agent-mission-control/dashboard-overview'

function formatKpi(value: number | null, suffix?: string): string {
  if (value === null) return '—'
  return suffix ? `${value}${suffix}` : String(value)
}

function formatCost(value: number | null): string {
  if (value === null) return '—'
  return `$${value.toFixed(2)}`
}

/**
 * Command-center KPI strip — the 5 mandated headline signals, in a fixed
 * order: Executable now, Runs 24h, Success 24h, Cost 24h, Needs action.
 * "Needs action" anchors the band (hero + accent when non-zero) because it is
 * the one number that tells an operator "go do something"; every other KPI
 * reads white or recedes to muted when unmeasured. Never a fabricated 0 —
 * an unmeasured value renders as an em-dash via `formatKpi`/`formatCost`.
 */
export function DashboardKpiStrip({ kpis }: { kpis: DashboardKpis }) {
  const needsActionActive = kpis.needsAction > 0

  const stats: AgentKpiStat[] = [
    {
      name: 'Executable Now',
      value: formatKpi(kpis.executableNow),
      valueSize: 'compact',
      valueTone: kpis.executableNow === null ? 'muted' : 'default',
      // Every tile carries a hint in EVERY state. The band reserves this line
      // unconditionally (`stat.hint ?? ' '`), so a tile that leaves it undefined
      // does not shrink — it renders a blank strip under its value while its
      // neighbours are captioned, which reads as a hole rather than as silence.
      // Each string below is verifiable: none of them asserts a measurement that
      // was not taken.
      hint:
        kpis.executableNow === null || kpis.executableTotal === null
          ? 'not measured'
          : `of ${kpis.executableTotal} agents`,
    },
    {
      name: 'Runs 24h',
      value: String(kpis.runs24h),
      valueSize: 'compact',
      valueTone: kpis.runs24h === 0 ? 'muted' : 'default',
      hint: kpis.runs24h === 0 ? 'none recorded' : 'in the last 24h',
    },
    {
      name: 'Success 24h',
      value: kpis.success24h === null ? '—' : formatKpi(kpis.success24h),
      suffix: kpis.success24h === null ? undefined : '%',
      valueSize: 'compact',
      valueTone: kpis.success24h === null ? 'muted' : 'default',
      hint: kpis.success24h === null ? 'no terminal runs' : 'of terminal runs',
    },
    {
      name: 'Cost 24h',
      value: formatCost(kpis.cost24h),
      valueSize: 'compact',
      valueTone: kpis.cost24h === null ? 'muted' : 'default',
      // Not "no cost": a run without usage data reports nothing, which is not
      // the same claim as a run that cost zero.
      hint: kpis.cost24h === null ? 'no cost data' : 'measured usage only',
    },
    {
      name: 'Needs Action',
      value: String(kpis.needsAction),
      valueSize: needsActionActive ? 'hero' : 'compact',
      valueTone: needsActionActive ? 'accent' : 'muted',
      hint: needsActionActive ? 'see Requires Attention' : 'nothing pending',
    },
  ]

  // `separators`, not `flush`: the five KPIs read as ONE synthesis band with
  // hairline dividers. Flush left them as bare text floating on the page with
  // no surface of their own (§4).
  return <AgentKpiBand stats={stats} separators />
}

/** Data-integrity note — a quiet hairline footer, never a full-width banner. */
export function DashboardDataWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null
  return (
    <div className="flex items-start gap-2 border-b border-zinc-950/5 pb-3">
      {/* Zinc, not accent: accent is the colour of a healthy run, so a data gap
          painted in it read as a reassurance. Not danger either — this footer is
          deliberately quiet (see the doc above) and an unread metric is not a
          failure. The triangle carries the warning without the hue, which is
          what the doctrine asks of every status. `zinc-400` rather than `-600`:
          the latter measures 2.44 against this plane, i.e. an integrity notice
          too faint to read. */}
      <ExclamationTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-zinc-400" />
      <ul className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
        {warnings.map((w) => (
          <li key={w} className="font-mono">{w}</li>
        ))}
      </ul>
    </div>
  )
}
