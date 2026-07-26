import { HourlyCostChart } from '@/components/agent-ops/dashboard-charts/chart-primitives'
import { HOUR_MS, hourLabel } from '@/components/agent-ops/dashboard-charts/chart-frame'
import { EmptyState } from '@/components/agent-ops/empty-state'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import type { AgentRun } from '@/lib/agent-mission-control/types'

interface CostBucket {
  startMs: number
  costUsd: number
  /** Runs in this hour that actually carried a measured cost (costUsd !== null). */
  measuredRunCount: number
}

/**
 * Buckets runs into hourly slots like `bucketRunsByHour`, but sums ONLY
 * measured cost (`costUsd !== null`). Runs with a null cost (LangGraph, no
 * usage reported) contribute nothing to the sum and are not counted as
 * "measured" — so an hour with zero measured runs stays visually empty rather
 * than a fake flat zero.
 */
function bucketCostByHour(runs: AgentRun[], nowMs: number, hours = 24): CostBucket[] {
  const endMs = Math.ceil(nowMs / HOUR_MS) * HOUR_MS
  const startMs = endMs - hours * HOUR_MS

  const buckets: CostBucket[] = Array.from({ length: hours }, (_, i) => ({
    startMs: startMs + i * HOUR_MS,
    costUsd: 0,
    measuredRunCount: 0,
  }))

  for (const run of runs) {
    if (run.costUsd === null || run.costUsd === undefined) continue
    const t = Date.parse(run.startedAt)
    if (Number.isNaN(t) || t < startMs || t >= endMs) continue
    const bucket = buckets[Math.floor((t - startMs) / HOUR_MS)]
    if (!bucket) continue
    bucket.costUsd += run.costUsd
    bucket.measuredRunCount += 1
  }

  return buckets
}

function formatUsd(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`
}

/**
 * CostOverTimeChart — hourly measured spend over 24h, rendered with Recharts
 * (the doctrine's standard engine). Runs with `costUsd === null` (cost never
 * measured) contribute NOTHING to any bucket. If not a single run in the window
 * carries a measured cost, this renders the shared EmptyState — never a flat
 * zero line pretending to be real data. Bucketing stays server-side; only the
 * plot is a client island.
 */
export function CostOverTimeChart({ runs, nowMs }: { runs: AgentRun[]; nowMs: number }) {
  const buckets = bucketCostByHour(runs, nowMs)
  const totalCost = buckets.reduce((s, b) => s + b.costUsd, 0)
  const measuredRuns = buckets.reduce((s, b) => s + b.measuredRunCount, 0)

  if (measuredRuns === 0) {
    return (
      <SurfaceCard>
        <SurfaceCardHeader title="Cost over time — 24h" className="px-4 pt-3 pb-2" />
        <EmptyState
          title="No measured cost in the last 24h"
          description="Runs in this window either have no cost data (LangGraph runs without usage) or there were no runs at all."
        />
      </SurfaceCard>
    )
  }

  const data = buckets.map((b) => ({
    label: hourLabel(b.startMs),
    costUsd: b.costUsd,
    measuredRunCount: b.measuredRunCount,
  }))

  return (
    <SurfaceCard className="h-full">
      <SurfaceCardHeader
        title="Cost over time — 24h"
        className="px-4 pt-3 pb-2"
        meta={
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            <span className="font-mono text-xs text-zinc-400 tabular-nums">{formatUsd(totalCost)} total</span>
            <span className="text-xs text-zinc-500">
              {measuredRuns} run{measuredRuns === 1 ? '' : 's'} measured
            </span>
          </div>
        }
      />
      <div className="px-4 pb-4">
        {/* Plot zone sits on the sunken plane: the trace reads inside a well,
            not floating on the panel face (§11). */}
        <div className="rounded-lg px-3 pt-3 pb-2 dark:bg-surface-sunken/60">
          <HourlyCostChart
            data={data}
            formatUsd={formatUsd}
            ariaLabel={`Hourly measured cost for the last 24 hours: ${formatUsd(totalCost)} total across ${measuredRuns} measured runs.`}
          />
        </div>
      </div>
    </SurfaceCard>
  )
}
