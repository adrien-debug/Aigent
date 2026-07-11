import clsx from 'clsx'

import { Divider } from '@/components/catalyst/divider'

const trendLabels = {
  up: 'Trending up',
  down: 'Trending down',
  flat: 'Flat',
} as const

/**
 * Catalyst demo "Stat" rhythm: a thin top divider, label, big value, delta
 * badge — no card chrome (doctrine: KPI strips are trait-separated stats,
 * not boxes).
 */
export function AgentMetricCard({
  label,
  value,
  delta,
  trend = 'flat',
  hint,
  viz,
  className,
}: {
  label: string
  value: string
  delta?: string
  trend?: 'up' | 'down' | 'flat'
  hint?: string
  /** Optional inline visualization (meter/gauge/bar) rendered under the value. */
  viz?: React.ReactNode
  className?: string
}) {
  return (
    <div className={clsx(className)}>
      <Divider />
      <dl>
        <dt className="mt-6 text-sm/6 font-medium text-zinc-500 sm:text-xs/6 dark:text-zinc-400">{label}</dt>
        <dd className="mt-3 font-mono text-3xl/8 font-semibold text-zinc-950 tabular-nums sm:text-2xl/8 dark:text-white">
          {value}
        </dd>
        {viz ? <dd className="mt-3">{viz}</dd> : null}
        {delta || hint ? (
          <dd className="mt-3 flex items-baseline gap-x-2 text-sm/6 sm:text-xs/6">
            {delta ? (
              <>
                <span className="sr-only">{trendLabels[trend]}:</span>
                <span
                  className={
                    trend === 'down'
                      ? 'font-medium text-accent-600 dark:text-accent-400'
                      : 'font-medium text-zinc-600 dark:text-zinc-300'
                  }
                >
                  {delta}
                </span>
              </>
            ) : null}
            {hint ? <span className="text-zinc-500">{hint}</span> : null}
          </dd>
        ) : null}
      </dl>
    </div>
  )
}
