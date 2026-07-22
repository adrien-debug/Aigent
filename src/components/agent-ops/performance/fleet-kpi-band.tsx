import { AgentKpiBand, type AgentKpiStat } from '@/components/agent-ops/agent-kpi-band'
import { bucketRunsByHour } from '@/components/agent-ops/dashboard-charts/chart-frame'
import { formatDurationMs, formatPercent, formatUsd } from '@/lib/agent-mission-control/format'
import type { AgentRun, Copilot, CopilotHealthMetric } from '@/lib/agent-mission-control/types'

const numberFormat = new Intl.NumberFormat('en-US')

/** The one glyph for "nothing proved this". Never `0`, never `NaN`. */
const NOT_MEASURED = '—'

/**
 * Is this metric a MEASUREMENT on this copilot?
 *
 * `data.ts` normalises the partial `copilots.health` blob and names whatever it
 * could not prove in `healthUnavailableFields`; the number left behind is a
 * placeholder. An `undefined` list means the row never went through the data
 * layer, so nothing is proven — that reads as unmeasured, not as measured.
 */
function isMeasured(copilot: Copilot, metric: CopilotHealthMetric): boolean {
  const unavailable = copilot.healthUnavailableFields
  if (unavailable === undefined) return false
  return !unavailable.includes(metric)
}

function measuredOn(copilots: Copilot[], metric: CopilotHealthMetric): Copilot[] {
  return copilots.filter((c) => isMeasured(c, metric))
}

/**
 * Sum over the copilots that actually measured the metric.
 *
 * `null` when NOT ONE of them did: a fleet total nobody measured is unknown,
 * and printing `0` would claim the fleet ran nothing. This is what used to
 * produce `NaN` — `openWarnings` is absent from every `health: {}` blob the
 * provisioning script writes, and `undefined + undefined` is not a number.
 */
function sumMeasured(copilots: Copilot[], metric: CopilotHealthMetric): number | null {
  const contributors = measuredOn(copilots, metric)
  if (contributors.length === 0) return null
  return contributors.reduce((sum, c) => sum + c.health[metric], 0)
}

/**
 * Fleet-wide aggregates. EVERY field is nullable and `null` means "not one
 * agent measured this" — distinct from a measured `0`.
 *
 * The two averages keep their own measured sets: `healthEvidence === 'runs'`
 * proves a run existed, not that latency was resolved (the `list` health mode
 * skips latency entirely), so weighting one by the other's population produced
 * an average over values nobody read.
 */
function computeFleetKpis(copilots: Copilot[]) {
  const runsLast24h = sumMeasured(copilots, 'runsLast24h')
  const costLast24hUsd = sumMeasured(copilots, 'costLast24hUsd')
  const openWarnings = sumMeasured(copilots, 'openWarnings')

  // Weight by 24h volume so a quiet agent does not distort the fleet mean; a
  // copilot whose volume was never measured cannot carry a weight, so it is
  // excluded from the average rather than counted as weight 1.
  const weightOf = (c: Copilot) => Math.max(c.health.runsLast24h, 1)
  const weightedAverage = (metric: CopilotHealthMetric): number | null => {
    const backed = measuredOn(copilots, metric).filter(
      (c) => c.healthEvidence === 'runs' && isMeasured(c, 'runsLast24h')
    )
    const totalWeight = backed.reduce((s, c) => s + weightOf(c), 0)
    if (totalWeight === 0) return null
    return backed.reduce((s, c) => s + c.health[metric] * weightOf(c), 0) / totalWeight
  }

  return {
    runsLast24h,
    costLast24hUsd,
    openWarnings,
    avgPassRate: weightedAverage('testPassRate'),
    avgLatencyMs: weightedAverage('avgLatencyMs'),
    /** How many agents actually measured `openWarnings` — qualifies the total. */
    warningsMeasuredCount: measuredOn(copilots, 'openWarnings').length,
    agentsWithWarnings: measuredOn(copilots, 'openWarnings').filter((c) => c.health.openWarnings > 0)
      .length,
  }
}

/**
 * FleetKpiBand — the Performance page's 5 headline stats as one unified band
 * (AgentKpiBand with hairline separators). All five share compact size so
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

  // Compact band — H1 owns the page scale; KPI values stay below Heading (text-xl).
  // Accent only when Open Warnings > 0 (actionable). No hero size, no accent wash.
  const stats: AgentKpiStat[] = [
    {
      name: 'Total Runs 24h',
      value: kpis.runsLast24h === null ? NOT_MEASURED : numberFormat.format(kpis.runsLast24h),
      valueSize: 'compact',
      hint: windowTotal > 0 ? `peak ${peakPerHour}/h` : undefined,
    },
    {
      name: 'Avg Success',
      value: kpis.avgPassRate === null ? NOT_MEASURED : formatPercent(kpis.avgPassRate, 0),
      valueSize: 'compact',
      hint:
        windowCompleted + windowFailed > 0
          ? `${windowCompleted} completed · ${windowFailed} failed`
          : undefined,
    },
    {
      name: 'Avg Latency',
      value: kpis.avgLatencyMs === null ? NOT_MEASURED : formatDurationMs(Math.round(kpis.avgLatencyMs)),
      valueSize: 'compact',
    },
    {
      name: '24h Cost',
      value: kpis.costLast24hUsd === null ? NOT_MEASURED : formatUsd(kpis.costLast24hUsd),
      valueSize: 'compact',
      // A per-run average needs BOTH terms measured, and a division by a
      // measured zero is not a cost either.
      hint:
        kpis.costLast24hUsd !== null && kpis.runsLast24h !== null && kpis.runsLast24h > 0
          ? `≈ ${formatUsd(kpis.costLast24hUsd / kpis.runsLast24h)}/run`
          : undefined,
    },
    {
      name: 'Open Warnings',
      value: kpis.openWarnings === null ? NOT_MEASURED : numberFormat.format(kpis.openWarnings),
      valueSize: 'compact',
      // Accent is reserved for something to act on; an unknown is not one.
      valueTone: kpis.openWarnings !== null && kpis.openWarnings > 0 ? 'accent' : 'muted',
      // The hint says how many agents the total actually covers — "across 0 of
      // 4 agents" under a NaN was the exact shape of the old lie.
      hint:
        kpis.openWarnings === null
          ? copilots.length > 0
            ? `not measured on any of ${copilots.length} agents`
            : undefined
          : `across ${kpis.agentsWithWarnings} of ${kpis.warningsMeasuredCount} measured agents`,
    },
  ]

  // `separators` so the five headline stats read as ONE synthesis band, matching
  // the dashboard KPI strip. Naked-on-canvas left them as floating text with no
  // surface, which is exactly the flatness this page was reported for.
  return <AgentKpiBand stats={stats} density="compact" separators className={className} />
}
