import clsx from 'clsx'

import { SurfaceCard, SurfaceCardHeader, surfaceCardClass } from '@/components/agent-ops/surface-card'
import type { AgentRun } from '@/lib/agent-mission-control/types'

const HOUR_MS = 3_600_000

export interface HourBucket {
  /** UTC start of the hour, epoch ms. */
  startMs: number
  completed: number
  failed: number
  /** running / blocked / needs-confirmation. */
  other: number
  total: number
  costUsd: number
}

/**
 * Bucket runs into hourly UTC slots covering the last `hours` hours (window
 * end = `nowMs` rounded UP to the next hour boundary, so the current partial
 * hour is the last bucket). Runs outside the window are dropped. Deterministic
 * from its inputs — shared by ActivityChart and FleetKpiBand so both surfaces
 * read the exact same histogram.
 */
export function bucketRunsByHour(runs: AgentRun[], nowMs: number, hours = 24): HourBucket[] {
  const endMs = Math.ceil(nowMs / HOUR_MS) * HOUR_MS
  const startMs = endMs - hours * HOUR_MS

  const buckets: HourBucket[] = Array.from({ length: hours }, (_, i) => ({
    startMs: startMs + i * HOUR_MS,
    completed: 0,
    failed: 0,
    other: 0,
    total: 0,
    costUsd: 0,
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
    // null = cost not measured (LangGraph, no usage): contributes nothing, never a fake 0.
    bucket.costUsd += run.costUsd ?? 0
  }

  return buckets
}

function hourLabel(startMs: number): string {
  return `${new Date(startMs).toISOString().slice(11, 13)}:00`
}

function runCount(n: number): string {
  return `${n} run${n === 1 ? '' : 's'}`
}

// Fixed drawing space — the SVG stretches horizontally (preserveAspectRatio
// "none") while its rendered height stays compact, so
// horizontal hairlines never blur and only bar widths flex with the viewport.
const PLOT_W = 960
const PLOT_H = 96
const TOP_PAD = 8
const SLOT_W = PLOT_W / 24
const BAR_W = 26
const BAR_X = (SLOT_W - BAR_W) / 2
const MIN_SEG_H = 1.5

function LegendDot({ className, label, count }: { className: string; label: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className={`size-2 rounded-full ${className}`} />
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="font-mono text-xs text-zinc-400 tabular-nums">{count}</span>
    </span>
  )
}

/**
 * ActivityChart — stacked hourly run histogram over the last 24h, hand-rolled
 * server SVG on the `--chart-*` tokens (completed = accent, failed = zinc-400,
 * other = zinc-600). No chart lib, no client JS: native `<title>` tooltips per
 * bar, sparse UTC hour labels as an HTML rail under the plot so text never
 * distorts with the stretched SVG.
 */
export function ActivityChart({ runs, nowMs }: { runs: AgentRun[]; nowMs: number }) {
  const buckets = bucketRunsByHour(runs, nowMs)
  const total = buckets.reduce((s, b) => s + b.total, 0)
  const completed = buckets.reduce((s, b) => s + b.completed, 0)
  const failed = buckets.reduce((s, b) => s + b.failed, 0)
  const other = buckets.reduce((s, b) => s + b.other, 0)

  if (total === 0) {
    return (
      <div className={clsx(surfaceCardClass, 'flex items-center gap-2 px-6 py-3')}>
        <span aria-hidden="true" className="size-1.5 rounded-full bg-zinc-600" />
        <span className="text-xs text-zinc-500">Run activity · 0 runs in last 24h</span>
      </div>
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
          {/* Hairline grid — quarter lines + baseline, chart-grid token (white/5). */}
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
                  <rect
                    key={seg.key}
                    x={x}
                    y={y}
                    width={BAR_W}
                    height={h}
                    rx={1}
                    fill={seg.fill}
                    className={seg.className}
                  />
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
        </svg>

        {/* Four UTC hour markers in equal columns under the 24 hourly slots. */}
        <div
          aria-hidden="true"
          className="mt-2 grid grid-cols-[repeat(24,minmax(0,1fr))]"
        >
          {buckets.map((bucket, i) => (
            <span
              key={bucket.startMs}
              className="text-center font-mono text-[10px] text-zinc-500 tabular-nums"
            >
              {i % 6 === 0 ? hourLabel(bucket.startMs) : ''}
            </span>
          ))}
        </div>
        </div>
      </div>
    </SurfaceCard>
  )
}
