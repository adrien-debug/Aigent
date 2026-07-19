import { AgentKpiBand, type AgentKpiStat } from '@/components/agent-ops/agent-kpi-band'
import { bucketRunsByHour } from '@/components/agent-ops/performance/activity-chart'
import { formatDurationMs, formatPercent, formatUsd } from '@/lib/agent-mission-control/format'
import type { AgentRun, Copilot } from '@/lib/agent-mission-control/types'

const numberFormat = new Intl.NumberFormat('en-US')

/** Fleet-wide averages — pure aggregation over per-copilot health rollups. */
export function computeFleetKpis(copilots: Copilot[]) {
  const runsLast24h = copilots.reduce((s, c) => s + c.health.runsLast24h, 0)
  const costLast24hUsd = copilots.reduce((s, c) => s + c.health.costLast24hUsd, 0)
  const openWarnings = copilots.reduce((s, c) => s + c.health.openWarnings, 0)

  // Averages only over run-backed copilots, weighted by their 24h volume so a
  // quiet agent does not distort the fleet mean.
  const backed = copilots.filter((c) => c.healthEvidence === 'runs')
  const weightOf = (c: Copilot) => Math.max(c.health.runsLast24h, 1)
  const totalWeight = backed.reduce((s, c) => s + weightOf(c), 0)
  const avgPassRate =
    backed.length > 0 ? backed.reduce((s, c) => s + c.health.testPassRate * weightOf(c), 0) / totalWeight : null
  const avgLatencyMs =
    backed.length > 0 ? backed.reduce((s, c) => s + c.health.avgLatencyMs * weightOf(c), 0) / totalWeight : null

  return { runsLast24h, costLast24hUsd, openWarnings, avgPassRate, avgLatencyMs }
}

/**
 * FleetKpiBand — the Performance page's 5 headline stats on the canvas (naked
 * AgentKpiBand, never inside a section card). All five share compact size so
 * they sit under the page H1; accent only on Open Warnings when >0.
 */
export function FleetKpiBand({
  copilots,
  runs,
  nowMs,
  className,
}: {
  copilots: Copilot[]
  runs: AgentRun[]
  nowMs: number
  className?: string
}) {
  const kpis = computeFleetKpis(copilots)
  const buckets = bucketRunsByHour(runs, nowMs)

  const windowTotal = buckets.reduce((s, b) => s + b.total, 0)
  const windowCompleted = buckets.reduce((s, b) => s + b.completed, 0)
  const windowFailed = buckets.reduce((s, b) => s + b.failed, 0)
  const peakPerHour = Math.max(...buckets.map((b) => b.total))

  const agentsWithWarnings = copilots.filter((c) => c.health.openWarnings > 0).length

  // Compact band — H1 owns the page scale; KPI values stay below Heading (text-xl).
  // Accent only when Open Warnings > 0 (actionable). No hero size, no accent wash.
  const stats: AgentKpiStat[] = [
    {
      name: 'Total Runs 24h',
      value: numberFormat.format(kpis.runsLast24h),
      valueSize: 'compact',
      hint: windowTotal > 0 ? `peak ${peakPerHour}/h` : undefined,
    },
    {
      name: 'Avg Success',
      value: kpis.avgPassRate === null ? '—' : formatPercent(kpis.avgPassRate, 0),
      valueSize: 'compact',
      hint:
        windowCompleted + windowFailed > 0
          ? `${windowCompleted} completed · ${windowFailed} failed`
          : undefined,
    },
    {
      name: 'Avg Latency',
      value: kpis.avgLatencyMs === null ? '—' : formatDurationMs(Math.round(kpis.avgLatencyMs)),
      valueSize: 'compact',
    },
    {
      name: '24h Cost',
      value: formatUsd(kpis.costLast24hUsd),
      valueSize: 'compact',
      hint:
        kpis.runsLast24h > 0 ? `≈ ${formatUsd(kpis.costLast24hUsd / kpis.runsLast24h)}/run` : undefined,
    },
    {
      name: 'Open Warnings',
      value: numberFormat.format(kpis.openWarnings),
      valueSize: 'compact',
      valueTone: kpis.openWarnings > 0 ? 'accent' : 'muted',
      hint: copilots.length > 0 ? `across ${agentsWithWarnings} of ${copilots.length} agents` : undefined,
    },
  ]

  return <AgentKpiBand stats={stats} density="compact" className={className} />
}
