import { CheckCircleIcon, ExclamationTriangleIcon, XCircleIcon } from '@heroicons/react/16/solid'
import clsx from 'clsx'

import { RuntimeBadge } from '@/components/agent-ops/runtime-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { formatDurationMs, formatPercent, formatUsd } from '@/lib/agent-mission-control/format'
import { MODEL_PROVIDER_LABELS } from '@/lib/agent-mission-control/mock-data'
import type { BenchmarkResult, BenchmarkRun } from '@/lib/agent-mission-control/types'

const numericCell = 'text-right font-mono tabular-nums'

/**
 * Compact safety count chip: green check when the count is 0, otherwise a
 * toned count with an icon. Full label lives in `title` + sr-only text so the
 * column stays narrow at 1440px without losing meaning.
 */
function ViolationChip({
  count,
  label,
  tone,
}: {
  count: number
  label: string
  tone: 'rose' | 'amber'
}) {
  const clean = count === 0
  const Icon = clean ? CheckCircleIcon : tone === 'amber' ? ExclamationTriangleIcon : XCircleIcon

  return (
    <span
      title={`${count} ${label}`}
      className={clsx(
        'inline-flex items-center gap-1 font-mono text-sm font-medium tabular-nums',
        clean
          ? 'text-green-700 dark:text-green-400'
          : tone === 'amber'
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-rose-600 dark:text-rose-400'
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
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
          <TableHeader className="text-right">Avg</TableHeader>
          <TableHeader className="text-right">P95</TableHeader>
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
              <div className="mt-0.5 text-xs text-zinc-500">{MODEL_PROVIDER_LABELS[run.modelProvider]}</div>
            </TableCell>
            <TableCell>
              <RuntimeBadge runtime={run.runtime} />
            </TableCell>
            <TableCell className={clsx(numericCell, 'font-semibold text-zinc-950 dark:text-white')}>{result.score}</TableCell>
            <TableCell className={clsx(numericCell, 'text-zinc-700 dark:text-zinc-300')}>{formatPercent(result.accuracy)}</TableCell>
            <TableCell className={clsx(numericCell, 'text-zinc-700 dark:text-zinc-300')}>
              {formatPercent(result.taskSuccessRate)}
            </TableCell>
            <TableCell className={clsx(numericCell, 'text-zinc-700 dark:text-zinc-300')}>{formatDurationMs(result.avgLatencyMs)}</TableCell>
            <TableCell className={clsx(numericCell, 'text-zinc-700 dark:text-zinc-300')}>{formatDurationMs(result.p95LatencyMs)}</TableCell>
            <TableCell className={clsx(numericCell, 'text-zinc-700 dark:text-zinc-300')}>
              {formatUsd(result.avgCostPerTaskUsd)}
            </TableCell>
            <TableCell className={clsx(numericCell, 'text-zinc-700 dark:text-zinc-300')}>{formatUsd(result.totalCostUsd)}</TableCell>
            <TableCell className="text-right">
              {result.unsafeActionCount === 0 ? (
                <span className="inline-flex items-center gap-1 font-mono font-medium text-green-700 tabular-nums dark:text-green-400">
                  <CheckCircleIcon aria-hidden="true" className="size-4 shrink-0" />
                  0<span className="sr-only"> unsafe actions</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-mono font-medium text-rose-600 tabular-nums dark:text-rose-400">
                  <XCircleIcon aria-hidden="true" className="size-4 shrink-0" />
                  {result.unsafeActionCount}
                  <span className="sr-only"> unsafe actions</span>
                </span>
              )}
            </TableCell>
            <TableCell
              className={clsx(
                numericCell,
                result.unauthorizedRouteCount > 0 ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-zinc-500'
              )}
            >
              {result.unauthorizedRouteCount}
            </TableCell>
            <TableCell
              className={clsx(
                numericCell,
                result.confirmationMistakeCount > 0 ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-zinc-500'
              )}
            >
              {result.confirmationMistakeCount}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
