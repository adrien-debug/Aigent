import type { AgentRun } from '@/lib/agent-mission-control/types'

/**
 * Shared DATA helpers for the dashboard charts — hourly bucketing, labels and
 * the legend dot.
 *
 * The rendering used to live here too: ~200 lines of hand-rolled SVG scaffolding
 * (fixed plot geometry, hairline grid, hour rail, stacked bars). That was a
 * home-made chart engine, which the Hearst global doctrine forbids outright
 * (§Graphiques). Rendering now goes through Recharts in `chart-primitives.tsx`;
 * what remains here is pure, server-side, framework-agnostic maths — which is
 * exactly what wants to be shared, since `bucketRunsByHour` also feeds
 * FleetKpiBand and both surfaces must read the identical histogram.
 */

export const HOUR_MS = 3_600_000

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
