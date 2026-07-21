import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { EmptyState } from '@/components/agent-ops/empty-state'
import type { AgentRun } from '@/lib/agent-mission-control/types'

const HOUR_MS = 3_600_000
const PLOT_W = 960
const PLOT_H = 96
const TOP_PAD = 8

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
 * "measured" — so a hard with zero measured runs stays visually empty rather
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

function hourLabel(startMs: number): string {
  return `${new Date(startMs).toISOString().slice(11, 13)}:00`
}

function formatUsd(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`
}

/**
 * CostOverTimeChart — hourly measured spend over 24h, hand-rolled server SVG
 * (line/area on the `--chart-*` tokens, no lib). Runs with `costUsd === null`
 * (cost never measured) contribute NOTHING to any bucket. If not a single run
 * in the window carries a measured cost, this renders the shared EmptyState —
 * never a flat zero line pretending to be real data.
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

  const maxCost = Math.max(...buckets.map((b) => b.costUsd), 0.0001)
  const scaleY = (v: number) => PLOT_H - (v / maxCost) * (PLOT_H - TOP_PAD)
  const stepX = PLOT_W / (buckets.length - 1 || 1)

  const points = buckets.map((b, i) => `${i * stepX},${scaleY(b.costUsd)}`).join(' ')
  const areaPoints = `0,${PLOT_H} ${points} ${PLOT_W},${PLOT_H}`

  return (
    <SurfaceCard>
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
        <svg
          role="img"
          aria-label={`Hourly measured cost for the last 24 hours: ${formatUsd(totalCost)} total across ${measuredRuns} measured runs.`}
          viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
          preserveAspectRatio="none"
          className="block h-24 w-full"
        >
          {[0.25, 0.5, 0.75].map((f) => {
            const y = TOP_PAD + (PLOT_H - TOP_PAD) * (1 - f)
            return (
              <line
                key={f}
                x1={0}
                x2={PLOT_W}
                y1={y}
                y2={y}
                stroke="var(--chart-grid)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )
          })}
          <line
            x1={0}
            x2={PLOT_W}
            y1={PLOT_H - 0.5}
            y2={PLOT_H - 0.5}
            stroke="var(--chart-grid)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />

          <polygon points={areaPoints} fill="var(--chart-success)" fillOpacity={0.12} />
          <polyline
            points={points}
            fill="none"
            stroke="var(--chart-success)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />

          {buckets.map((b, i) => (
            <g key={b.startMs}>
              <title>
                {`${hourLabel(b.startMs)}–${hourLabel(b.startMs + HOUR_MS)} UTC · ${formatUsd(b.costUsd)}${b.measuredRunCount > 0 ? ` across ${b.measuredRunCount} run${b.measuredRunCount === 1 ? '' : 's'}` : ' — no measured runs'}`}
              </title>
              <rect x={i * stepX - stepX / 2} y={0} width={stepX} height={PLOT_H} fill="transparent" />
              {b.costUsd > 0 ? (
                <circle cx={i * stepX} cy={scaleY(b.costUsd)} r={2.5} fill="var(--chart-success)" />
              ) : null}
            </g>
          ))}
        </svg>

          <div aria-hidden="true" className="mt-2 grid grid-cols-[repeat(24,minmax(0,1fr))]">
            {buckets.map((b, i) => (
              <span key={b.startMs} className="text-center font-mono text-[10px] text-zinc-500 tabular-nums">
                {i % 6 === 0 ? hourLabel(b.startMs) : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
    </SurfaceCard>
  )
}
