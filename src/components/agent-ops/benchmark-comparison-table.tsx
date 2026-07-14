import { ChartBarIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'

import { EmptyState } from '@/components/agent-ops/empty-state'
import { RuntimeBadge } from '@/components/agent-ops/runtime-badge'
import { LinearMeter } from '@/components/agent-ops/widgets/linear-meter'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { formatDurationMs, formatPercent, formatUsd } from '@/lib/agent-mission-control/format'
import { MODEL_PROVIDER_LABELS } from '@/lib/agent-mission-control/labels'
import type { BenchmarkResult, BenchmarkRun } from '@/lib/agent-mission-control/types'

const numericCell = 'text-right font-mono tabular-nums'

/**
 * Compact safety count as plain muted text (no color/icon by count value).
 * Full label lives in `title` + sr-only text so the column stays narrow at
 * 1440px without losing meaning.
 */
function ViolationChip({
  count,
  label,
}: {
  count: number
  label: string
}) {
  return (
    <span
      title={`${count} ${label}`}
      className="font-mono text-sm font-medium tabular-nums text-zinc-500 dark:text-zinc-400"
    >
      {count}
      <span className="sr-only"> {label}</span>
    </span>
  )
}

/**
 * Every completed benchmark run for a suite, ranked by composite score
 * (descending). Rendered flush inside a card via Catalyst Table bleed.
 */
export function BenchmarkComparisonTable({
  rows,
}: {
  rows: { run: BenchmarkRun; result: BenchmarkResult }[]
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ChartBarIcon}
        title="No completed runs to compare"
        description="Run this benchmark suite to rank candidate models by composite score, accuracy, latency and cost."
      />
    )
  }

  const sorted = [...rows].sort((a, b) => b.result.score - a.result.score)

  return (
    <Table dense bleed className="[--gutter:--spacing(6)]">
      <TableHead>
        <TableRow>
          <TableHeader>Model</TableHeader>
          <TableHeader>Runtime</TableHeader>
          <TableHeader className="text-right">Score</TableHeader>
          <TableHeader className="text-right">Accuracy</TableHeader>
          <TableHeader className="text-right">Success</TableHeader>
          <TableHeader className="text-right">
            Latency<span className="sr-only"> average / p95</span>
          </TableHeader>
          <TableHeader className="text-right">Cost / task</TableHeader>
          <TableHeader className="text-right">Total</TableHeader>
          <TableHeader className="text-right">Violations</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {sorted.map(({ run, result }) => (
          <TableRow key={run.id}>
            <TableCell>
              <div className="font-mono text-sm font-medium text-zinc-950 dark:text-white">{run.model}</div>
              <div className="mt-1 text-xs text-zinc-500">{MODEL_PROVIDER_LABELS[run.modelProvider]}</div>
            </TableCell>
            <TableCell>
              <RuntimeBadge runtime={run.runtime} />
            </TableCell>
            <TableCell className={clsx(numericCell, 'text-zinc-950 dark:text-white')}>
              <div className="font-semibold">{result.score}</div>
              <div className="mt-1">
                <LinearMeter
                  value={result.score}
                  max={100}
                  size="xs"
                  tone="accent"
                  ariaLabel={`Composite score ${result.score} of 100`}
                />
              </div>
            </TableCell>
            <TableCell className={clsx(numericCell, 'text-zinc-700 dark:text-zinc-300')}>{formatPercent(result.accuracy)}</TableCell>
            <TableCell className={clsx(numericCell, 'text-zinc-700 dark:text-zinc-300')}>
              {formatPercent(result.taskSuccessRate)}
            </TableCell>
            <TableCell className={clsx(numericCell, 'text-zinc-700 dark:text-zinc-300')}>
              <div>{formatDurationMs(result.avgLatencyMs)}</div>
              <div className="text-xs text-zinc-500">
                {formatDurationMs(result.p95LatencyMs)}
                <span className="sr-only"> p95</span>
              </div>
            </TableCell>
            <TableCell className={clsx(numericCell, 'text-zinc-700 dark:text-zinc-300')}>
              {formatUsd(result.avgCostPerTaskUsd)}
            </TableCell>
            <TableCell className={clsx(numericCell, 'text-zinc-700 dark:text-zinc-300')}>{formatUsd(result.totalCostUsd)}</TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-3">
                <ViolationChip count={result.unsafeActionCount} label="unsafe actions" />
                <ViolationChip count={result.unauthorizedRouteCount} label="unauthorized routes" />
                <ViolationChip count={result.confirmationMistakeCount} label="confirmation mistakes" />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
