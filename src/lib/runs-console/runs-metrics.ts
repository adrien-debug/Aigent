import type { AgentRun } from '@/lib/agent-mission-control/types'

/**
 * AIGENT-FRONTEND-RESET-001 — the ONE metric derivation for the runs cockpit.
 * KPI cards, the success ring and the table footer all read this; there is no
 * second place where a total, a rate or a cost is recomputed.
 *
 * Truthfulness rules encoded here, not in the components:
 *  - `successRate` is `null` when no run reached a terminal state. A rate needs
 *    a denominator; with none, the UI must say "Not measured", never "0%" or
 *    "100%".
 *  - `measuredCostUsd` is `null` when NO run carried a measured cost. Runs with
 *    `costUsd === null` (LangGraph with no usage) are excluded from the sum and
 *    counted in `unmeasuredCostRuns` so the UI can disclose the gap instead of
 *    presenting a partial sum as a fleet total.
 */

export interface RunsMetrics {
  total: number
  running: number
  completed: number
  failed: number
  blocked: number
  needsConfirmation: number
  /** completed + failed + blocked — the runs that actually finished. */
  terminal: number
  /** completed / terminal, 0..1. `null` when `terminal === 0` (not measurable). */
  successRate: number | null
  /** Sum over runs whose cost WAS measured. `null` when none were. */
  measuredCostUsd: number | null
  measuredCostRuns: number
  unmeasuredCostRuns: number
  /** Runs that recorded at least one blocked/unsafe tool attempt. */
  unsafeAttemptRuns: number
  /** Mean `latencyMs` over runs with a finite latency. `null` when none did. */
  avgLatencyMs: number | null
  /** p95 `latencyMs` over the same set. `null` when none did. */
  p95LatencyMs: number | null
  /** Runs with a finite `latencyMs` — the denominator for both figures above. */
  measuredLatencyRuns: number
  /** Sum of `toolCallCount` over all runs — a real 0 is a real 0. */
  totalToolCalls: number
}

export function deriveRunsMetrics(runs: AgentRun[]): RunsMetrics {
  let running = 0
  let completed = 0
  let failed = 0
  let blocked = 0
  let needsConfirmation = 0
  let measuredCostRuns = 0
  let costSum = 0
  let unsafeAttemptRuns = 0
  let totalToolCalls = 0
  const latencySamples: number[] = []

  for (const run of runs) {
    switch (run.status) {
      case 'running':
        running += 1
        break
      case 'completed':
        completed += 1
        break
      case 'failed':
        failed += 1
        break
      case 'blocked':
        blocked += 1
        break
      case 'needs-confirmation':
        needsConfirmation += 1
        break
    }

    if (typeof run.costUsd === 'number' && Number.isFinite(run.costUsd)) {
      measuredCostRuns += 1
      costSum += run.costUsd
    }

    if (run.unsafeAttemptCount > 0) unsafeAttemptRuns += 1
    totalToolCalls += run.toolCallCount

    if (typeof run.latencyMs === 'number' && Number.isFinite(run.latencyMs)) {
      latencySamples.push(run.latencyMs)
    }
  }

  const terminal = completed + failed + blocked

  const sortedLatencies = latencySamples.toSorted((a, b) => a - b)
  const avgLatencyMs =
    sortedLatencies.length > 0 ? sortedLatencies.reduce((sum, v) => sum + v, 0) / sortedLatencies.length : null
  const p95LatencyMs = sortedLatencies.length > 0 ? percentile95(sortedLatencies) : null

  return {
    total: runs.length,
    running,
    completed,
    failed,
    blocked,
    needsConfirmation,
    terminal,
    successRate: terminal > 0 ? completed / terminal : null,
    measuredCostUsd: measuredCostRuns > 0 ? costSum : null,
    measuredCostRuns,
    unmeasuredCostRuns: runs.length - measuredCostRuns,
    unsafeAttemptRuns,
    avgLatencyMs,
    p95LatencyMs,
    measuredLatencyRuns: sortedLatencies.length,
    totalToolCalls,
  }
}

/** `sorted` must already be ascending and non-empty. Linear-interpolated rank,
 *  the same method `runs-timeseries.ts` uses per hourly bucket. */
function percentile95(sorted: number[]): number {
  if (sorted.length === 1) return sorted[0]
  const rank = 0.95 * (sorted.length - 1)
  const lowIndex = Math.floor(rank)
  const highIndex = Math.ceil(rank)
  if (lowIndex === highIndex) return sorted[lowIndex]
  const weight = rank - lowIndex
  return sorted[lowIndex] * (1 - weight) + sorted[highIndex] * weight
}

/** THE ONE precision rule for this metric, consumed by every renderer that
 *  shows it — the KPI card figure, the ring's aria label, and (via
 *  `formatSuccessFigure` below) the ring's own centre text. Integers stay
 *  integers ("100%", "0%"); anything else keeps one decimal ("83.3%"). This
 *  mirrors `RingGauge`'s internal `formatFigure` exactly, on purpose: before
 *  this fix the two used different rules (`Math.round` here vs
 *  integer-or-one-decimal there) and printed different figures for the same
 *  rate — "83" beside "83.3", "0.0%" beside a bare "0". `rate` is the 0..1
 *  ratio from `RunsMetrics.successRate`; callers pass the already-null-checked
 *  value, `null` is never handled here. */
export function formatPercent(rate: number): string {
  const percent = rate * 100
  const figure = Number.isInteger(percent) ? String(percent) : String(Math.round(percent * 10) / 10)
  return `${figure}%`
}

/** Same rule as `formatPercent`, without the `%` — for renderers (the ring's
 *  centre text, its aria label) that compose the figure into their own
 *  wording instead of a bare percentage. */
export function formatSuccessFigure(rate: number): string {
  const percent = rate * 100
  return Number.isInteger(percent) ? String(percent) : String(Math.round(percent * 10) / 10)
}

/** `null`/non-finite latency renders as an em dash upstream, never as "0ms". */
export function formatDuration(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${rest}s`
}
