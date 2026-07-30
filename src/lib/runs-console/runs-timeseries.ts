import type { AgentRun } from '@/lib/agent-mission-control/types'

/**
 * Hourly bucketing for the `/admin/runs` observability charts — the ONE place
 * that turns a flat run array into a time series. Every chart on the screen
 * (`TrendChart`) reads its `points` from here; no chart recomputes its own
 * bucketing, so two charts covering the same runs can never disagree about
 * which hour a run landed in.
 *
 * TRUTH RULES, same family as `runs-metrics.ts`:
 *  - a COUNT bucket (runs, completed, failed, blocked, tool calls, errors) is
 *    real at 0 — an hour with no runs really had zero, so it is `0`, not a gap.
 *  - a MEASUREMENT bucket (avg/p95 latency, cost) is `NaN` for an hour that
 *    held no runs contributing a value: `TrendChart` drops non-finite points
 *    and breaks the curve there instead of drawing a fabricated flat line
 *    through an unmeasured hour.
 */

export interface RunsHourlyBuckets {
  /** Oldest → newest, `HH:00 UTC` labels, one per hour of the observed span. */
  xLabels: string[]
  runsPerHour: number[]
  completedPerHour: number[]
  failedPerHour: number[]
  blockedPerHour: number[]
  /** Mean `latencyMs` of runs with a finite latency in that hour, or `NaN`. */
  avgLatencyMsPerHour: number[]
  /** p95 `latencyMs` of runs with a finite latency in that hour, or `NaN`. */
  p95LatencyMsPerHour: number[]
  /** Sum of `costUsd` over runs with a MEASURED cost in that hour, or `NaN`
   *  when none of that hour's runs measured a cost. */
  costUsdPerHour: number[]
  toolCallsPerHour: number[]
  /** failed + blocked for that hour. */
  errorsPerHour: number[]
}

const pad2 = (value: number) => String(value).padStart(2, '0')

function hourLabelUtc(ms: number): string {
  const date = new Date(ms)
  return `${pad2(date.getUTCHours())}:00`
}

function percentile95(sorted: number[]): number {
  if (sorted.length === 0) return NaN
  if (sorted.length === 1) return sorted[0]
  const rank = 0.95 * (sorted.length - 1)
  const lowIndex = Math.floor(rank)
  const highIndex = Math.ceil(rank)
  if (lowIndex === highIndex) return sorted[lowIndex]
  const weight = rank - lowIndex
  return sorted[lowIndex] * (1 - weight) + sorted[highIndex] * weight
}

/**
 * `spanMs` is the OBSERVED span (the active period filter, not always 24h):
 * bucketing a 1h view into 24 hourly columns would draw 23 empty columns
 * beside the one real hour. `hours` is derived from it and clamped to
 * [1, 24] — the loader's own window never exceeds 24h, so 24 buckets is
 * already the finest this data can ever legitimately support.
 */
export function buildRunsHourlyBuckets(runs: AgentRun[], nowMs: number, spanMs: number): RunsHourlyBuckets {
  const HOUR_MS = 60 * 60 * 1000
  const hours = Math.min(24, Math.max(1, Math.round(spanMs / HOUR_MS)))
  // The LAST bucket is the hour ENDING at `nowMs` (a trailing window, matching
  // `applyRunsFilters`'s `since = nowMs - PERIOD_MS`), not the calendar hour
  // `nowMs` currently sits in — at an exact hour boundary those two hours
  // differ by a full hour, which silently dropped every run from the hour
  // that had just closed.
  const lastBucketStartMs = Math.floor((nowMs - 1) / HOUR_MS) * HOUR_MS
  const bucketStartMs = lastBucketStartMs - (hours - 1) * HOUR_MS

  const xLabels: string[] = []
  for (let i = 0; i < hours; i += 1) xLabels.push(hourLabelUtc(bucketStartMs + i * HOUR_MS))

  const runsPerHour = Array.from({ length: hours }, () => 0)
  const completedPerHour = Array.from({ length: hours }, () => 0)
  const failedPerHour = Array.from({ length: hours }, () => 0)
  const blockedPerHour = Array.from({ length: hours }, () => 0)
  const toolCallsPerHour = Array.from({ length: hours }, () => 0)
  const errorsPerHour = Array.from({ length: hours }, () => 0)
  const latencySamples: number[][] = Array.from({ length: hours }, () => [])
  const costSums = Array.from({ length: hours }, () => 0)
  const costCounts = Array.from({ length: hours }, () => 0)

  for (const run of runs) {
    const startedMs = Date.parse(run.startedAt)
    if (!Number.isFinite(startedMs)) continue
    const index = Math.floor((startedMs - bucketStartMs) / (HOUR_MS))
    if (index < 0 || index >= hours) continue

    runsPerHour[index] += 1
    toolCallsPerHour[index] += run.toolCallCount
    if (run.status === 'completed') completedPerHour[index] += 1
    if (run.status === 'failed') failedPerHour[index] += 1
    if (run.status === 'blocked') blockedPerHour[index] += 1
    if (run.status === 'failed' || run.status === 'blocked') errorsPerHour[index] += 1

    if (typeof run.latencyMs === 'number' && Number.isFinite(run.latencyMs)) {
      latencySamples[index].push(run.latencyMs)
    }
    if (typeof run.costUsd === 'number' && Number.isFinite(run.costUsd)) {
      costSums[index] += run.costUsd
      costCounts[index] += 1
    }
  }

  const avgLatencyMsPerHour = latencySamples.map((samples) =>
    samples.length === 0 ? NaN : samples.reduce((sum, v) => sum + v, 0) / samples.length
  )
  const p95LatencyMsPerHour = latencySamples.map((samples) => percentile95(samples.toSorted((a, b) => a - b)))
  const costUsdPerHour = costSums.map((sum, index) => (costCounts[index] === 0 ? NaN : sum))

  return {
    xLabels,
    runsPerHour,
    completedPerHour,
    failedPerHour,
    blockedPerHour,
    avgLatencyMsPerHour,
    p95LatencyMsPerHour,
    costUsdPerHour,
    toolCallsPerHour,
    errorsPerHour,
  }
}
