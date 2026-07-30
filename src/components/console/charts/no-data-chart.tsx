import { cn } from '@/components/ui/cn'

/**
 * The COMPACT placeholder for a chart with no series to plot — the frame
 * `ChartCard` swaps in when its data is empty, deliberately NOT the same size
 * as a populated plate.
 *
 * WHY COMPACT MATTERS. `TrendChart` (`./trend-chart.tsx`) already draws a full
 * frame — grid, rails, baseline, legend — for a genuinely empty *series*
 * because that frame is data (an interval WAS observed, it just held nothing).
 * This component is for the opposite situation: there is no chart to frame at
 * all, so drawing 220px of empty grid is a lie of scale — it claims a plot
 * exists. `NoDataChart` is capped low (`h-24`, 96px) on purpose: big enough to
 * read as "a chart lives here", too short to read as "a chart is plotted
 * here". `check-no-empty-chart-frame.mjs` fails on any chart-shaped container
 * in this domain taller than that without an empty-series guard.
 */
export function NoDataChart({
  label = 'No data to plot',
  detail,
  className,
}: {
  label?: string
  detail?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex h-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong bg-surface-app px-3 text-center',
        className
      )}
    >
      <span aria-hidden className="text-sm text-zinc-600">
        ╱╲
      </span>
      <p className="text-[11px]/4 text-zinc-500">{label}</p>
      {detail ? <p className="text-[10px]/4 text-zinc-600">{detail}</p> : null}
    </div>
  )
}
