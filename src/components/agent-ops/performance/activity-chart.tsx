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
import { EmptyState } from '@/components/agent-ops/empty-state'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import type { AgentRun } from '@/lib/agent-mission-control/types'

/**
 * ActivityChart — stacked hourly run histogram over the last 24h, hand-rolled
 * server SVG on the `--chart-*` tokens (completed = accent, failed = zinc-400,
 * other = zinc-600). No chart lib, no client JS: native `<title>` tooltips per
 * bar, sparse UTC hour labels as an HTML rail under the plot so text never
 * distorts with the stretched SVG. Shared bucketing / geometry / grid / hour
 * rail live in `dashboard-charts/chart-frame.tsx`.
 */
export function ActivityChart({ runs, nowMs }: { runs: AgentRun[]; nowMs: number }) {
  const buckets = bucketRunsByHour(runs, nowMs)
  const total = buckets.reduce((s, b) => s + b.total, 0)
  const completed = buckets.reduce((s, b) => s + b.completed, 0)
  const failed = buckets.reduce((s, b) => s + b.failed, 0)
  const other = buckets.reduce((s, b) => s + b.other, 0)

  if (total === 0) {
    return (
      <SurfaceCard>
        <EmptyState title="No run activity" description="No runs in the last 24h." />
      </SurfaceCard>
    )
  }

  const scale = (PLOT_H - TOP_PAD) / Math.max(...buckets.map((b) => b.total))

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Run Activity — 24h"
        className="px-4 pt-3 pb-2"
        meta={
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            <LegendDot className="bg-accent-400" label="Completed" count={completed} />
            <LegendDot className="bg-zinc-400" label="Failed" count={failed} />
            {other > 0 ? <LegendDot className="bg-zinc-600" label="Other" count={other} /> : null}
          </div>
        }
      />
      <div className="px-4 pb-4">
        {/* Plot zone on the sunken plane — the trace reads inside a well rather
            than floating on the panel face (§11), matching the dashboard charts. */}
        <div className="rounded-lg px-3 pt-3 pb-2 dark:bg-surface-sunken/60">
        <svg
          role="img"
          aria-label={`Hourly run activity for the last 24 hours: ${runCount(total)} — ${completed} completed, ${failed} failed, ${other} other.`}
          viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
          preserveAspectRatio="none"
          className="block h-24 w-full"
        >
          <ChartGrid />

          <StackedHourBars buckets={buckets} scale={scale} />
        </svg>

        {/* Four UTC hour markers in equal columns under the 24 hourly slots. */}
        <HourLabelRail buckets={buckets} />
        </div>
      </div>
    </SurfaceCard>
  )
}
