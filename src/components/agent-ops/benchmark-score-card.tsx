import { CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/16/solid'
import clsx from 'clsx'

import { RuntimeBadge } from '@/components/agent-ops/runtime-badge'
import { Badge } from '@/components/catalyst/badge'
import { formatDurationMs, formatPercent, formatUsd } from '@/lib/agent-mission-control/format'
import { MODEL_PROVIDER_LABELS } from '@/lib/agent-mission-control/mock-data'
import type { BenchmarkResult, BenchmarkRun } from '@/lib/agent-mission-control/types'

/** Semantic tone for a composite score: green ≥ 80, amber 60–79, rose < 60. */
function scoreTone(score: number): { bar: string; text: string } {
  if (score >= 80) return { bar: 'bg-accent-500', text: 'text-accent-700 dark:text-accent-400' }
  if (score >= 60) return { bar: 'bg-accent-500', text: 'text-accent-600 dark:text-accent-400' }
  return { bar: 'bg-accent-500', text: 'text-accent-600 dark:text-accent-400' }
}

function unsafeLabel(count: number): string {
  return count === 1 ? '1 unsafe action' : `${count} unsafe actions`
}

function MetricRow({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-x-4 py-2 first:pt-0 last:pb-0">
      <dt className="text-sm text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd
        className={clsx(
          'font-mono text-sm tabular-nums',
          emphasize ? 'font-medium text-zinc-950 dark:text-white' : 'text-zinc-700 dark:text-zinc-300'
        )}
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * One benchmark candidate as an order-summary style card: identity band,
 * composite score with meter, metric receipt rows, safety verdict footer.
 */
export function BenchmarkScoreCard({
  run,
  result,
  isBest = false,
}: {
  run: BenchmarkRun
  result: BenchmarkResult
  isBest?: boolean
}) {
  const tone = scoreTone(result.score)
  const isSafe = result.unsafeActionCount === 0

  return (
    <article
      className={clsx(
        'overflow-hidden rounded-xl bg-white dark:bg-zinc-950',
        isBest ? 'ring-2 ring-accent-500/40' : 'ring-1 ring-zinc-950/5 dark:ring-white/10'
      )}
    >
      {/* Identical skeleton on every card so rows of cards align pixel-for-pixel:
          name + provider left, runtime badge top-right, then a fixed-height status
          slot (winner chip or invisible placeholder) above the score. */}
      <div className="flex items-start justify-between gap-x-4 border-b border-zinc-950/5 px-6 py-4 dark:border-white/5">
        <div className="min-w-0">
          <h3 className="truncate font-mono text-sm font-medium text-zinc-950 dark:text-white">{run.model}</h3>
          <p className="mt-1 text-xs text-zinc-500">{MODEL_PROVIDER_LABELS[run.modelProvider]}</p>
        </div>
        <div className="shrink-0">
          <RuntimeBadge runtime={run.runtime} />
        </div>
      </div>

      <div className="border-b border-zinc-950/5 px-6 py-4 dark:border-white/5">
        <div className="flex h-6 items-center" aria-hidden={isBest ? undefined : true}>
          <span className={isBest ? undefined : 'invisible'}>
            <Badge color="accent">Best candidate</Badge>
          </span>
        </div>
        <p className="mt-3 text-xs font-medium tracking-wide text-zinc-500 uppercase">Composite score</p>
        <p className="mt-2 font-mono text-3xl font-semibold text-zinc-950 tabular-nums dark:text-white">
          {result.score}
          <span className="ml-1 text-sm font-normal text-zinc-500">/ 100</span>
        </p>
        <div
          role="meter"
          aria-label="Composite score"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={result.score}
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-950/5 dark:bg-white/5"
        >
          <div className={clsx('h-full rounded-full', tone.bar)} style={{ width: `${result.score}%` }} />
        </div>
      </div>

      <div className="px-6 py-4">
        <dl className="divide-y divide-zinc-950/5 dark:divide-white/5">
          <MetricRow label="Accuracy" value={formatPercent(result.accuracy)} />
          <MetricRow label="Task success" value={formatPercent(result.taskSuccessRate)} />
          <MetricRow label="Avg latency" value={formatDurationMs(result.avgLatencyMs)} />
          <MetricRow label="P95 latency" value={formatDurationMs(result.p95LatencyMs)} />
          <MetricRow label="Cost per task" value={formatUsd(result.avgCostPerTaskUsd)} />
          <MetricRow label="Total cost" value={formatUsd(result.totalCostUsd)} emphasize />
        </dl>
      </div>

      <div className="flex items-center gap-2 border-t border-zinc-950/5 px-6 py-4 dark:border-white/5">
        {isSafe ? (
          <CheckCircleIcon aria-hidden="true" className="size-4 shrink-0 text-accent-600 dark:text-accent-400" />
        ) : (
          <ExclamationTriangleIcon aria-hidden="true" className="size-4 shrink-0 text-accent-600 dark:text-accent-400" />
        )}
        <span
          className={clsx(
            'text-sm font-medium tabular-nums',
            isSafe ? 'text-accent-700 dark:text-accent-400' : 'text-accent-600 dark:text-accent-400'
          )}
        >
          {unsafeLabel(result.unsafeActionCount)}
        </span>
      </div>
    </article>
  )
}
