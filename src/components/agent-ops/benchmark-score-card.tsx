import { CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/16/solid'
import clsx from 'clsx'

import { RuntimeBadge } from '@/components/agent-ops/runtime-badge'
import { LinearMeter } from '@/components/agent-ops/widgets/linear-meter'
import { RadialMeter } from '@/components/agent-ops/widgets/radial-meter'
import { Badge } from '@/components/catalyst/badge'
import { Subheading } from '@/components/catalyst/heading'
import { formatDurationMs, formatPercent, formatUsd } from '@/lib/agent-mission-control/format'
import { MODEL_PROVIDER_LABELS } from '@/lib/agent-mission-control/labels'
import type { BenchmarkResult, BenchmarkRun } from '@/lib/agent-mission-control/types'

/** One field in the 2-column metric grid: label, mono value, optional inline meter. */
function Field({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-zinc-950 tabular-nums dark:text-white">{value}</dd>
      {children ? <dd className="mt-1.5">{children}</dd> : null}
    </div>
  )
}

/**
 * Compact safety count chip: check when the count is 0, warning otherwise.
 * Monochrome — meaning rides on the icon + label, never a second hue.
 */
function ViolationChip({ count, label, title }: { count: number; label: string; title: string }) {
  const clean = count === 0
  const Icon = clean ? CheckCircleIcon : ExclamationTriangleIcon

  return (
    <span title={`${count} ${title}`} className="inline-flex items-center gap-1.5">
      <Icon
        aria-hidden="true"
        className={clsx('size-4 shrink-0', clean ? 'text-accent-600 dark:text-accent-400' : 'text-accent-700 dark:text-accent-500')}
      />
      <span
        className={clsx(
          'font-mono text-sm font-medium tabular-nums',
          clean ? 'text-zinc-700 dark:text-zinc-300' : 'text-accent-700 dark:text-accent-500'
        )}
      >
        {count}
      </span>
      <span className="text-xs text-zinc-500">{label}</span>
    </span>
  )
}

/**
 * One benchmark candidate as a dense widget card: a flush identity row, a radial
 * composite-score gauge beside a 2-column metric grid (accuracy & task success
 * carry inline meters), and an inline safety chip footer. Sub-regions are split
 * by hairlines + whitespace — no box-in-box. The card ring stays; `isBest` keeps
 * a ring-2 accent as the selectable/winner affordance.
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
  return (
    <article
      className={clsx(
        'rounded-xl bg-white p-6 dark:bg-zinc-950',
        // Winner card: copper selection ring (--copper-line-strong) + a subtle
        // elevation halo (--copper-glow) — the sanctioned use of these two
        // role tokens (selection affordance + elevation), never a second hue.
        isBest
          ? 'ring-2 ring-[var(--copper-line-strong)] shadow-[0_0_0_1px_var(--copper-line),0_8px_28px_-12px_var(--copper-glow)]'
          : 'ring-1 ring-zinc-950/5 dark:ring-white/10'
      )}
    >
      {/* Identity row — model + provider left, winner slot (fixed height so twin
          cards align) + runtime right. */}
      <div className="flex items-start justify-between gap-x-4">
        <div className="min-w-0">
          <Subheading level={3} className="truncate font-mono">
            {run.model}
          </Subheading>
          <p className="mt-1 text-xs text-zinc-500">{MODEL_PROVIDER_LABELS[run.modelProvider]}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex h-6 items-center" aria-hidden={isBest ? undefined : true}>
            <span className={isBest ? undefined : 'invisible'}>
              <Badge color="accent">Best</Badge>
            </span>
          </span>
          <RuntimeBadge runtime={run.runtime} />
        </div>
      </div>

      {/* Score gauge + metric grid. */}
      <div className="mt-6 flex items-center gap-6 border-t border-zinc-950/5 pt-6 dark:border-white/5">
        <div className="shrink-0">
          <RadialMeter
            value={result.score}
            max={100}
            size={88}
            strokeWidth={7}
            tone="accent"
            centerText={String(result.score)}
            caption="Composite"
            ariaLabel={`Composite score ${result.score} of 100`}
          />
        </div>
        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3">
          <Field label="Accuracy" value={formatPercent(result.accuracy)}>
            <LinearMeter value={result.accuracy} max={1} size="xs" tone="accent" ariaLabel="Accuracy" />
          </Field>
          <Field label="Task success" value={formatPercent(result.taskSuccessRate)}>
            <LinearMeter value={result.taskSuccessRate} max={1} size="xs" tone="accent" ariaLabel="Task success rate" />
          </Field>
          <Field label="Avg latency" value={formatDurationMs(result.avgLatencyMs)} />
          <Field label="P95 latency" value={formatDurationMs(result.p95LatencyMs)} />
          <Field label="Cost / task" value={formatUsd(result.avgCostPerTaskUsd)} />
          <Field label="Total cost" value={formatUsd(result.totalCostUsd)} />
        </dl>
      </div>

      {/* Safety footer — inline violation chips, no padded band. */}
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-zinc-950/5 pt-4 dark:border-white/5">
        <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Safety</span>
        <ViolationChip count={result.unsafeActionCount} label="unsafe" title="unsafe actions" />
        <ViolationChip count={result.unauthorizedRouteCount} label="routes" title="unauthorized routes" />
        <ViolationChip count={result.confirmationMistakeCount} label="confirm" title="confirmation mistakes" />
      </div>
    </article>
  )
}
