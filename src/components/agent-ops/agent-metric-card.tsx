import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from '@heroicons/react/16/solid'
import clsx from 'clsx'

const trendStyles = {
  up: 'text-green-700 dark:text-green-400',
  down: 'text-rose-600 dark:text-rose-400',
  flat: 'text-zinc-500 dark:text-zinc-400',
} as const

const trendIcons = {
  up: ArrowUpIcon,
  down: ArrowDownIcon,
  flat: MinusIcon,
} as const

const trendLabels = {
  up: 'Trending up',
  down: 'Trending down',
  flat: 'Flat',
} as const

export function AgentMetricCard({
  label,
  value,
  delta,
  trend = 'flat',
  hint,
}: {
  label: string
  value: string
  delta?: string
  trend?: 'up' | 'down' | 'flat'
  hint?: string
}) {
  const TrendIcon = trendIcons[trend]

  return (
    <div className="rounded-xl bg-white px-4 py-5 ring-1 ring-zinc-950/5 sm:px-6 dark:bg-zinc-900 dark:ring-white/10">
      <dl className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</dt>
        {delta ? (
          <dd className={clsx('flex items-baseline gap-x-1 text-xs font-medium tabular-nums', trendStyles[trend])}>
            <TrendIcon aria-hidden="true" className="size-3 shrink-0 self-center" />
            <span className="sr-only">{trendLabels[trend]}:</span>
            {delta}
          </dd>
        ) : null}
        <dd className="w-full flex-none font-mono text-2xl font-semibold text-zinc-950 tabular-nums dark:text-white">
          {value}
        </dd>
        {hint ? <dd className="w-full flex-none text-xs text-zinc-500">{hint}</dd> : null}
      </dl>
    </div>
  )
}
