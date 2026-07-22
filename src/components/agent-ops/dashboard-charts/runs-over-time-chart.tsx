import clsx from 'clsx'

import {
  ChartGrid,
  HourLabelRail,
  LegendDot,
  PLOT_H,
  PLOT_W,
  StackedHourBars,
  TOP_PAD,
  bucketRunsByHour,
  runCount,
} from '@/components/agent-ops/dashboard-charts/chart-frame'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import type { AgentRun } from '@/lib/agent-mission-control/types'

/**
 * RunsOverTimeChart — hourly completed-vs-failed histogram over 24h. Same
 * hand-rolled server SVG approach as ActivityChart (`performance/activity-chart.tsx`),
 * reusing the shared `bucketRunsByHour` helper (`dashboard-charts/chart-frame.tsx`)
 * so both surfaces read the identical histogram math. "Other"
 * (running/blocked/needs-confirmation) is folded out of the legend here — this
 * chart's job is completed vs failed only; the status breakdown chart carries
 * the full split.
 */
export function RunsOverTimeChart({ runs, nowMs }: { runs: AgentRun[]; nowMs: number }) {
  const buckets = bucketRunsByHour(runs, nowMs)
  const total = buckets.reduce((s, b) => s + b.total, 0)
  const completed = buckets.reduce((s, b) => s + b.completed, 0)
  const failed = buckets.reduce((s, b) => s + b.failed, 0)
  const other = buckets.reduce((s, b) => s + b.other, 0)

  if (total === 0) {
    return (
      <SurfaceCard>
        <SurfaceCardHeader title="Runs over time — 24h" className="px-4 pt-3 pb-2" />
        <div className={clsx('flex items-center gap-2 px-4 pb-4')}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-zinc-600" />
          <span className="text-xs text-zinc-500">No runs recorded in the last 24h.</span>
        </div>
      </SurfaceCard>
    )
  }

  const scale = (PLOT_H - TOP_PAD) / Math.max(...buckets.map((b) => b.total))

  return (
    <SurfaceCard className="h-full">
      <SurfaceCardHeader
        title="Runs over time — 24h"
        className="px-4 pt-3 pb-2"
        meta={
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            <span className="font-mono text-xs text-zinc-400 tabular-nums">{runCount(total)}</span>
            <LegendDot className="bg-accent-400" label="Completed" count={completed} />
            <LegendDot className="bg-zinc-400" label="Failed" count={failed} />
            {other > 0 ? <LegendDot className="bg-zinc-600" label="Other" count={other} /> : null}
          </div>
        }
      />
      <div className="px-4 pb-4">
        {/* Plot zone sits on the sunken plane: the trace reads inside a well,
            not floating on the panel face (§11). */}
        <div className="rounded-lg px-3 pt-3 pb-2 dark:bg-surface-sunken/60">
        <svg
          role="img"
          aria-label={`Hourly runs for the last 24 hours: ${runCount(total)} — ${completed} completed, ${failed} failed, ${other} other.`}
          viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
          preserveAspectRatio="none"
          className="block h-24 w-full"
        >
          <ChartGrid />

          <StackedHourBars buckets={buckets} scale={scale} />
        </svg>

          <HourLabelRail buckets={buckets} />
        </div>
      </div>
    </SurfaceCard>
  )
}
