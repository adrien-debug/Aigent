import { cn } from '@/components/ui/cn'
import { NoDataChart } from './no-data-chart'

/**
 * The chart FRAME: title, subtitle, data source, a bounded max-height, and an
 * automatic bail to `NoDataChart` when the series is empty. This is the one
 * place a screen should reach for a chart plate instead of hand-rolling a
 * `<div className="h-96">` around a chart component — a container that size
 * with no empty guard is exactly the "big empty rectangle" antipattern
 * `check-no-empty-chart-frame.mjs` looks for.
 *
 * `isEmpty` is a required, explicit prop rather than inferred from
 * `children` being falsy: inference would silently pass through a chart
 * component that renders its OWN internal empty frame (like `TrendChart`,
 * which is allowed to — it draws axis/grid even when empty, see its own
 * doc). `ChartCard.isEmpty` is for callers with a genuinely absent series,
 * where `NoDataChart`'s compact frame is correct and a full plotted frame
 * would be a lie of scale.
 */
export function ChartCard({
  title,
  subtitle,
  source,
  isEmpty,
  emptyDetail,
  children,
  className,
  maxHeight = 'max-h-80',
}: {
  title: string
  subtitle?: string
  /** Where the series was read from — every chart on this console names it. */
  source: string
  /** True when there is no series to plot at all. Required — never inferred. */
  isEmpty: boolean
  /** Extra line shown inside `NoDataChart` when `isEmpty`. */
  emptyDetail?: string
  children: React.ReactNode
  className?: string
  /** Named Tailwind rung, matching `SECTION_BODY_HEIGHTS` in `screen-primitives.tsx`. */
  maxHeight?: 'max-h-56' | 'max-h-80' | 'max-h-[26rem]'
}) {
  return (
    <div className={cn('flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface-raised', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-xs/5 font-semibold text-white">{title}</p>
          {subtitle ? <p className="mt-0.5 truncate text-[11px]/4 text-zinc-500">{subtitle}</p> : null}
        </div>
        <p className="shrink-0 text-[10px]/4 uppercase tracking-widest text-zinc-600">Source · {source}</p>
      </div>
      <div className={cn('min-w-0 overflow-hidden px-3 py-3', maxHeight)}>
        {isEmpty ? <NoDataChart detail={emptyDetail} /> : children}
      </div>
    </div>
  )
}
