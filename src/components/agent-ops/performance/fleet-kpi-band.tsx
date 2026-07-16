import { AgentKpiBand, type AgentKpiStat } from '@/components/agent-ops/agent-kpi-band'
import { bucketRunsByHour } from '@/components/agent-ops/performance/activity-chart'
import { LinearMeter } from '@/components/agent-ops/widgets/linear-meter'
import { SplitBar } from '@/components/agent-ops/widgets/split-bar'
import { Sparkline } from '@/components/agent-ops/widgets/sparkline'
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
 * FleetKpiBand — the Performance page's 5 headline stats, each carrying a
 * live micro-visualization in the `viz` slot when the real data supports one:
 * hourly run volume (bar sparkline), completed/failed mix (split bar), latency
 * trend (line sparkline), hourly spend (bar sparkline) and warning coverage
 * (linear meter). Everything derives from getCopilots()/getRecentRuns() —
 * nothing is fabricated; a signal without data simply renders no viz.
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

  // Latency trend — runs inside the 24h window, oldest first, so the line
  // reads left→right in time like the histogram below it.
  const windowStartMs = buckets[0].startMs
  const latencySeries = runs
    .filter((run) => {
      const t = Date.parse(run.startedAt)
      return !Number.isNaN(t) && t >= windowStartMs && run.latencyMs > 0
    })
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((run) => run.latencyMs)

  const costSeries = buckets.map((b) => b.costUsd)
  const windowCost = costSeries.reduce((s, v) => s + v, 0)

  const agentsWithWarnings = copilots.filter((c) => c.health.openWarnings > 0).length

  const stats: AgentKpiStat[] = [
    {
      name: 'Total Runs 24h',
      value: numberFormat.format(kpis.runsLast24h),
      valueTone: kpis.runsLast24h > 0 ? 'accent' : 'muted',
      viz:
        windowTotal > 0 ? (
          <Sparkline
            points={buckets.map((b) => b.total)}
            kind="bar"
            tone="accent"
            width={112}
            height={24}
            ariaLabel={`Runs per hour over the last 24 hours, peak ${peakPerHour} per hour`}
          />
        ) : undefined,
      hint: windowTotal > 0 ? `peak ${peakPerHour}/h` : undefined,
    },
    {
      name: 'Avg Success',
      value: kpis.avgPassRate === null ? '—' : formatPercent(kpis.avgPassRate, 0),
      valueTone: kpis.avgPassRate !== null && kpis.avgPassRate >= 0.9 ? 'accent' : 'default',
      viz:
        windowCompleted + windowFailed > 0 ? (
          <SplitBar
            showLegend={false}
            segments={[
              { key: 'completed', label: 'Completed', value: windowCompleted, tone: 'accent-500' },
              { key: 'failed', label: 'Failed', value: windowFailed, tone: 'zinc' },
            ]}
          />
        ) : undefined,
      hint:
        windowCompleted + windowFailed > 0
          ? `${windowCompleted} completed · ${windowFailed} failed`
          : undefined,
    },
    {
      name: 'Avg Latency',
      value: kpis.avgLatencyMs === null ? '—' : formatDurationMs(Math.round(kpis.avgLatencyMs)),
      viz:
        latencySeries.length > 1 ? (
          <Sparkline
            points={latencySeries}
            tone="zinc"
            width={112}
            height={24}
            ariaLabel={`Latency trend across ${latencySeries.length} recent runs`}
          />
        ) : undefined,
    },
    {
      name: '24h Cost',
      value: formatUsd(kpis.costLast24hUsd),
      viz:
        windowCost > 0 ? (
          <Sparkline
            points={costSeries}
            kind="bar"
            tone="zinc"
            width={112}
            height={24}
            ariaLabel={`Spend per hour over the last 24 hours, ${formatUsd(windowCost)} total`}
          />
        ) : undefined,
      hint:
        kpis.runsLast24h > 0 ? `≈ ${formatUsd(kpis.costLast24hUsd / kpis.runsLast24h)}/run` : undefined,
    },
    {
      name: 'Open Warnings',
      value: numberFormat.format(kpis.openWarnings),
      valueTone: kpis.openWarnings > 0 ? 'accent' : 'muted',
      viz:
        copilots.length > 0 ? (
          <LinearMeter
            value={agentsWithWarnings}
            max={copilots.length}
            size="xs"
            tone={kpis.openWarnings > 0 ? 'accentStrong' : 'zinc'}
            ariaLabel={`${agentsWithWarnings} of ${copilots.length} agents carry open warnings`}
          />
        ) : undefined,
      hint: copilots.length > 0 ? `across ${agentsWithWarnings} of ${copilots.length} agents` : undefined,
    },
  ]

  return <AgentKpiBand stats={stats} className={className} />
}
