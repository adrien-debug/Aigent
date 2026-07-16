import clsx from 'clsx'

import { AnimatedNumber } from '@/components/agent-ops/animated-number'

export interface AgentKpiStat {
  name: string
  value?: string
  /** Override the default value row — distribution lists, action slots, etc. */
  content?: React.ReactNode
  valueTone?: 'default' | 'accent' | 'muted'
  valueSize?: 'hero' | 'compact' | 'small'
  suffix?: string
  change?: string
  changeType?: 'positive' | 'negative'
  hint?: string
  viz?: React.ReactNode
}

const COLS_CLASS: Record<number, string> = {
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
  5: 'md:grid-cols-5',
}

const VALUE_SIZE_CLASS = {
  hero: 'text-4xl font-light tracking-tight',
  compact: 'text-2xl font-light tracking-tight',
  small: 'text-xl font-light tracking-tight',
} as const

const VALUE_TONE_CLASS = {
  default: 'text-white',
  accent: 'text-accent-400',
  muted: 'text-zinc-500',
} as const

/**
 * KPI band — single canon for all dashboard pages and agent sub-tabs.
 * Naked numbers on a hairline separator; accent reserved for emphasis only.
 */
export function AgentKpiBand({
  stats,
  className,
  density = 'default',
}: {
  stats: AgentKpiStat[]
  className?: string
  density?: 'default' | 'compact'
}) {
  const hasChange = stats.some((stat) => stat.change)
  const hasViz = stats.some((stat) => stat.viz)
  const hasHint = stats.some((stat) => stat.hint)

  const defaultValueSize = density === 'compact' ? 'compact' : 'hero'
  // Reserve a fixed two-line height for the label so a title that wraps
  // ("24H COMPUTE COST") does not push its value lower than its one-line
  // neighbours — every value row then starts on the same baseline.
  const labelClass =
    density === 'compact'
      ? 'flex min-h-8 items-start text-[10px] font-medium uppercase tracking-widest text-zinc-600 mb-1'
      : 'flex min-h-10 items-start text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2 group-hover:text-zinc-400 transition-colors'

  return (
    <div
      className={clsx(
        'grid grid-cols-1 border-b border-white/5 sm:grid-cols-2',
        density === 'compact' ? 'mb-10 gap-x-12 gap-y-6 py-4' : 'mb-8 gap-8 py-6',
        COLS_CLASS[stats.length] ??
          (stats.length >= 6 ? 'md:grid-cols-3 xl:grid-cols-6' : 'md:grid-cols-4'),
        className
      )}
    >
      {stats.map((stat) => {
        const valueSize = stat.valueSize ?? defaultValueSize
        const valueTone = stat.valueTone ?? 'default'

        return (
          <div key={stat.name || 'slot'} className="group flex flex-col cursor-default">
            {stat.name ? <span className={labelClass}>{stat.name}</span> : null}

            {hasChange ? (
              <span
                className={clsx(
                  'mb-1 h-4 text-xs font-medium tracking-tight tabular-nums',
                  stat.changeType === 'negative'
                    ? 'text-accent-400'
                    : stat.changeType === 'positive'
                      ? 'text-zinc-400'
                      : 'text-zinc-500'
                )}
              >
                {stat.change ?? ' '}
              </span>
            ) : null}

            {stat.content ?? (
              <div className="flex items-baseline gap-2">
                <span
                  className={clsx(
                    'tabular-nums',
                    VALUE_SIZE_CLASS[valueSize],
                    VALUE_TONE_CLASS[valueTone]
                  )}
                >
                  {stat.value != null ? <AnimatedNumber value={stat.value} /> : null}
                </span>
                {stat.suffix ? <span className="text-sm text-zinc-500">{stat.suffix}</span> : null}
              </div>
            )}

            {hasViz ? <div className="mt-2 w-full flex-none">{stat.viz ?? null}</div> : null}
            {hasHint ? (
              <span className="mt-1 text-xs text-zinc-500">{stat.hint ?? ' '}</span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
