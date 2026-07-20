import { Squares2X2Icon } from '@heroicons/react/24/outline'
import clsx from 'clsx'

import { EmptyState } from '@/components/agent-ops/empty-state'
import { Badge } from '@/components/catalyst/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { formatDurationMs, formatPercent, formatTimestamp, formatUsd } from '@/lib/agent-mission-control/format'
import { MODEL_PROVIDER_LABELS } from '@/lib/agent-mission-control/labels'
import type { BenchmarkResult, BenchmarkRun } from '@/lib/agent-mission-control/types'

/** A dimension that was never measured renders "—", never a misleading 0. */
function NotMeasuredDash() {
  return (
    <span className="text-zinc-500">
      <span aria-hidden="true">—</span>
      <span className="sr-only">not measured</span>
    </span>
  )
}

type ScoredRow = { run: BenchmarkRun; result: BenchmarkResult }

type Column = {
  key: string
  run: BenchmarkRun
  result: BenchmarkResult
}

type MetricRow = {
  key: string
  label: string
  /** Lower is better for latency / cost / violations. */
  lowerIsBetter: boolean
  /** `null` = the dimension was not measured for this column. */
  value: (result: BenchmarkResult) => number | null
  format: (value: number) => string
}

const METRICS: MetricRow[] = [
  { key: 'score', label: 'Score', lowerIsBetter: false, value: (r) => r.score, format: (v) => String(v) },
  { key: 'accuracy', label: 'Accuracy', lowerIsBetter: false, value: (r) => r.accuracy, format: formatPercent },
  { key: 'success', label: 'Success', lowerIsBetter: false, value: (r) => r.taskSuccessRate, format: formatPercent },
  { key: 'latency', label: 'Latency (avg)', lowerIsBetter: true, value: (r) => r.avgLatencyMs, format: formatDurationMs },
  {
    key: 'cost',
    label: 'Cost / task',
    lowerIsBetter: true,
    value: (r) => r.avgCostPerTaskUsd,
    format: (v) => formatUsd(v),
  },
  {
    key: 'violations',
    label: 'Violations',
    lowerIsBetter: true,
    value: (r) => r.unsafeActionCount + r.unauthorizedRouteCount + r.confirmationMistakeCount,
    format: (v) => String(v),
  },
]

function runTime(run: BenchmarkRun): number {
  return Date.parse(run.finishedAt ?? run.startedAt)
}

/**
 * Pivot of the comparison table: metrics down, executed models across.
 *
 * One column per distinct `provider + model` actually executed — the most
 * recent run wins, so a re-run replaces its own column instead of adding a
 * near-duplicate one. Under two distinct models there is nothing to pivot.
 */
export function BenchmarkShootoutMatrix({
  rows,
  unscoredRuns = [],
}: {
  rows: ScoredRow[]
  /**
   * Runs the suite produced without a usable result (aborted, still running).
   * Rendered as an explicit reason, never as a low score.
   */
  unscoredRuns?: BenchmarkRun[]
}) {
  const byModel = new Map<string, Column>()
  for (const { run, result } of rows) {
    const key = `${run.modelProvider}::${run.model}`
    const current = byModel.get(key)
    if (
      !current ||
      runTime(run) > runTime(current.run) ||
      (runTime(run) === runTime(current.run) && run.id > current.run.id)
    ) {
      byModel.set(key, { key, run, result })
    }
  }

  const columns = [...byModel.values()].sort((a, b) => b.result.score - a.result.score)

  if (columns.length < 2) {
    return (
      <EmptyState
        icon={Squares2X2Icon}
        title="Not enough distinct models to pivot"
        description="The shootout matrix compares at least two different executed models side by side. Run this suite against another candidate model to unlock it."
      />
    )
  }

  // Winner per metric — ties leave every tied cell unmarked (no arbitrary pick).
  const winners = new Map<string, string | null>()
  for (const metric of METRICS) {
    let best: { key: string; value: number } | null = null
    let tied = false
    for (const column of columns) {
      const value = metric.value(column.result)
      if (value === null || !Number.isFinite(value)) continue
      if (!best) {
        best = { key: column.key, value }
        continue
      }
      if (value === best.value) {
        tied = true
        continue
      }
      if (metric.lowerIsBetter ? value < best.value : value > best.value) {
        best = { key: column.key, value }
        tied = false
      }
    }
    winners.set(metric.key, best && !tied ? best.key : null)
  }

  return (
    <div className="space-y-4">
      {/* Bounded box: the matrix scrolls inside itself, the page body never does. */}
      <div className="max-h-[32rem] overflow-auto">
        <Table dense className="[--gutter:--spacing(0)]">
          <TableHead>
            <TableRow>
              <TableHeader>Metric</TableHeader>
              {columns.map((column) => (
                <TableHeader key={column.key} className="text-right">
                  <div className="font-mono text-sm font-medium text-zinc-950 dark:text-white">{column.run.model}</div>
                  <div className="mt-1 font-normal text-xs text-zinc-500">
                    {MODEL_PROVIDER_LABELS[column.run.modelProvider]}
                  </div>
                  <div className="mt-1 font-normal text-xs text-zinc-500">
                    {formatTimestamp(column.run.finishedAt ?? column.run.startedAt)}
                  </div>
                </TableHeader>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {METRICS.map((metric) => {
              const winnerKey = winners.get(metric.key) ?? null
              return (
                <TableRow key={metric.key}>
                  <TableCell className="text-zinc-700 dark:text-zinc-300">
                    {metric.label}
                    <span className="sr-only">{metric.lowerIsBetter ? ' (lower is better)' : ' (higher is better)'}</span>
                  </TableCell>
                  {columns.map((column) => {
                    const value = metric.value(column.result)
                    const isWinner = winnerKey === column.key
                    return (
                      <TableCell
                        key={column.key}
                        className={clsx(
                          'text-right font-mono tabular-nums',
                          isWinner
                            ? 'bg-[var(--accent-surface)] font-semibold text-zinc-950 dark:text-white'
                            : 'text-zinc-700 dark:text-zinc-300'
                        )}
                      >
                        {value === null || !Number.isFinite(value) ? <NotMeasuredDash /> : metric.format(value)}
                        {isWinner ? <span className="sr-only"> (best)</span> : null}
                      </TableCell>
                    )
                  })}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {unscoredRuns.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">
            Not compared — these runs produced no measurement, which is not a low score.
          </p>
          <ul className="space-y-2">
            {unscoredRuns.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                <span className="font-mono text-zinc-700 dark:text-zinc-300">{run.model}</span>
                <span>{MODEL_PROVIDER_LABELS[run.modelProvider]}</span>
                <Badge color="zinc">{run.status === 'aborted' ? 'no result recorded' : run.status}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
