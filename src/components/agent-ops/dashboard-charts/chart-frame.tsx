import type { AgentRun } from '@/lib/agent-mission-control/types'

/**
 * Shared chrome for the hand-rolled server-SVG dashboard charts — ActivityChart,
 * RunsOverTimeChart and CostOverTimeChart. Unifies the hourly bucketing
 * (`bucketRunsByHour` + `HourBucket`), the fixed plot geometry constants, the
 * hairline grid (`<ChartGrid/>`) and the UTC hour-label rail (`<HourLabelRail/>`)
 * that were duplicated byte-for-byte across the three charts, so all three read
 * the identical histogram math and render pixel-identical scaffolding.
 *
 * No chart lib, no client JS: pure presentational helpers on the `--chart-*`
 * tokens. `bucketRunsByHour` is also consumed by FleetKpiBand.
 */

export const HOUR_MS = 3_600_000

// Fixed drawing space — the SVG stretches horizontally (preserveAspectRatio
// "none") while its rendered height stays compact, so horizontal hairlines
// never blur and only bar widths flex with the viewport.
export const PLOT_W = 960
export const PLOT_H = 96
export const TOP_PAD = 8
export const SLOT_W = PLOT_W / 24
export const BAR_W = 26
export const BAR_X = (SLOT_W - BAR_W) / 2
export const MIN_SEG_H = 1.5

export interface HourBucket {
  /** UTC start of the hour, epoch ms. */
  startMs: number
  completed: number
  failed: number
  /** running / blocked / needs-confirmation. */
  other: number
  total: number
}

/**
 * Bucket runs into hourly UTC slots covering the last `hours` hours (window
 * end = `nowMs` rounded UP to the next hour boundary, so the current partial
 * hour is the last bucket). Runs outside the window are dropped. Deterministic
 * from its inputs — shared by ActivityChart and FleetKpiBand so both surfaces
 * read the exact same histogram.
 */
export function bucketRunsByHour(runs: AgentRun[], nowMs: number, hours = 24): HourBucket[] {
  // The window MUST match getRecentRunsInWindow (data.ts) exactly — [nowMs-24h,
  // nowMs] — or the chart total silently contradicts the "Runs 24h" KPI computed
  // from the same run set. A ceil-to-next-hour boundary shifted the window up to
  // an hour and dropped the oldest hour the KPI counts.
  const endMs = nowMs
  const startMs = endMs - hours * HOUR_MS

  const buckets: HourBucket[] = Array.from({ length: hours }, (_, i) => ({
    startMs: startMs + i * HOUR_MS,
    completed: 0,
    failed: 0,
    other: 0,
    total: 0,
  }))

  for (const run of runs) {
    const t = Date.parse(run.startedAt)
    if (Number.isNaN(t) || t < startMs || t >= endMs) continue
    const bucket = buckets[Math.floor((t - startMs) / HOUR_MS)]
    if (!bucket) continue
    if (run.status === 'completed') bucket.completed += 1
    else if (run.status === 'failed') bucket.failed += 1
    else bucket.other += 1
    bucket.total += 1
  }

  return buckets
}

export function hourLabel(startMs: number): string {
  return `${new Date(startMs).toISOString().slice(11, 13)}:00`
}

export function runCount(n: number): string {
  return `${n} run${n === 1 ? '' : 's'}`
}

export function LegendDot({ className, label, count }: { className: string; label: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className={`size-2 rounded-full ${className}`} />
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="font-mono text-xs text-zinc-400 tabular-nums">{count}</span>
    </span>
  )
}

/**
 * Hairline grid — quarter lines + baseline on the `--chart-grid` token (white/5).
 * Renders raw SVG elements; must live inside the chart's `<svg>`.
 */
export function ChartGrid() {
  return (
    <>
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
    </>
  )
}

/**
 * The UTC hour-label rail under the plot — four markers in equal columns across
 * the 24 hourly slots, as an HTML rail so text never distorts with the
 * horizontally-stretched SVG.
 */
export function HourLabelRail({ buckets }: { buckets: { startMs: number }[] }) {
  return (
    <div aria-hidden="true" className="mt-2 grid grid-cols-[repeat(24,minmax(0,1fr))]">
      {buckets.map((bucket, i) => (
        <span key={bucket.startMs} className="text-center font-mono text-[10px] text-zinc-500 tabular-nums">
          {i % 6 === 0 ? hourLabel(bucket.startMs) : ''}
        </span>
      ))}
    </div>
  )
}

/**
 * The stacked hourly bars — the core render loop shared verbatim by the runs
 * and activity charts (completed / failed / other segments stacked per hour,
 * with a full-slot transparent hit-rect so short/empty bars still surface the
 * tooltip). Extracted so the two charts share ONE source; the cost chart keeps
 * its own bars because it sums measured cost, not status counts.
 */
export function StackedHourBars({ buckets, scale }: { buckets: HourBucket[]; scale: number }) {
  return (
    <>
      {buckets.map((bucket, i) => {
        const x = i * SLOT_W + BAR_X
        const segments: { key: string; count: number; fill?: string; className?: string }[] = [
          { key: 'completed', count: bucket.completed, fill: 'var(--chart-success)' },
          { key: 'failed', count: bucket.failed, fill: 'var(--chart-series)' },
          { key: 'other', count: bucket.other, className: 'fill-zinc-600' },
        ]

        let y = PLOT_H
        const rects = segments
          .filter((seg) => seg.count > 0)
          .map((seg) => {
            const h = Math.max(seg.count * scale, MIN_SEG_H)
            y -= h
            return (
              <rect key={seg.key} x={x} y={y} width={BAR_W} height={h} rx={1} fill={seg.fill} className={seg.className} />
            )
          })

        const parts = [
          bucket.completed > 0 ? `${bucket.completed} completed` : null,
          bucket.failed > 0 ? `${bucket.failed} failed` : null,
          bucket.other > 0 ? `${bucket.other} other` : null,
        ].filter(Boolean)

        return (
          <g key={bucket.startMs}>
            <title>
              {`${hourLabel(bucket.startMs)}–${hourLabel(bucket.startMs + HOUR_MS)} UTC · ${runCount(bucket.total)}${parts.length > 0 ? ` — ${parts.join(', ')}` : ''}`}
            </title>
            {/* Transparent hit area so short (or empty) bars still surface the tooltip. */}
            <rect x={i * SLOT_W} y={0} width={SLOT_W} height={PLOT_H} fill="transparent" />
            {rects}
          </g>
        )
      })}
    </>
  )
}
