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
  }

  const terminal = completed + failed + blocked

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
  }
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount)
}

export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`
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
