import clsx from 'clsx'

import { Badge } from '@/components/catalyst/badge'
import { Divider } from '@/components/catalyst/divider'

const trendColors = {
  up: 'green',
  down: 'rose',
  flat: 'zinc',
} as const

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
  className,
}: {
  label: string
  value: string
  delta?: string
  trend?: 'up' | 'down' | 'flat'
  hint?: string
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
        {delta || hint ? (
          <dd className="mt-3 flex items-baseline gap-x-2 text-sm/6 sm:text-xs/6">
            {delta ? (
              <>
                <span className="sr-only">{trendLabels[trend]}:</span>
                <Badge color={trendColors[trend]}>{delta}</Badge>
              </>
            ) : null}
            {hint ? <span className="text-zinc-500">{hint}</span> : null}
          </dd>
        ) : null}
      </dl>
    </div>
  )
}
