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
  muted: 'text-zinc-400',
} as const

/**
 * KPI band — single canon for all dashboard pages and agent sub-tabs.
 * Naked numbers on a hairline separator; accent reserved for emphasis only.
 *
 * `separators` (opt-in, additive): hairline dividers between stats via the
 * `gap-px` grid technique (1px gaps over a white/5 backdrop, opaque cells) —
 * survives every wrap breakpoint, unlike divide-x. Padding then lives inside
 * each cell (px-6/lg:px-8 aligns the first stat with a card header), so
 * callers must NOT add outer horizontal padding in this mode. Cells are
 * filled with the canon card surface — use only inside a SurfaceCard.
 */
export function AgentKpiBand({
  stats,
  className,
  density = 'default',
  separators = false,
}: {
  stats: AgentKpiStat[]
  className?: string
  density?: 'default' | 'compact'
  /** Hairline separators between stats; padding moves into the cells. */
  separators?: boolean
}) {
  const hasChange = stats.some((stat) => stat.change)
  const hasViz = stats.some((stat) => stat.viz)
  const hasHint = stats.some((stat) => stat.hint)

  const defaultValueSize = density === 'compact' ? 'compact' : 'hero'
  // Reserve a fixed two-line height for the label so a title that wraps
  // ("24H COMPUTE COST") does not push its value lower than its one-line
  // neighbours — every value row then starts on the same baseline.
  const labelClass = separators
    ? 'flex min-h-8 items-start text-[10px] font-medium uppercase tracking-widest text-zinc-500 mb-3 transition-colors group-hover:text-zinc-400'
    : density === 'compact'
      ? 'flex min-h-8 items-start text-[10px] font-medium uppercase tracking-widest text-zinc-400 mb-1'
      : 'flex min-h-10 items-start text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-2 group-hover:text-zinc-300 transition-colors'

  return (
    <div
      className={clsx(
        'grid grid-cols-1 sm:grid-cols-2',
        separators
          ? 'gap-px bg-white/5'
          : [
              'border-b border-white/5',
              density === 'compact' ? 'mb-10 gap-x-12 gap-y-6 py-4' : 'mb-8 gap-8 py-6',
            ],
        COLS_CLASS[stats.length] ??
          (stats.length >= 6 ? 'md:grid-cols-3 xl:grid-cols-6' : 'md:grid-cols-4'),
        className
      )}
    >
      {stats.map((stat) => {
        const valueSize = stat.valueSize ?? defaultValueSize
        const valueTone = stat.valueTone ?? 'default'

        return (
          <div
            key={stat.name || 'slot'}
            className={clsx(
              'group flex flex-col cursor-default',
              // Opaque cells mask the white/5 backdrop except in the 1px gaps.
              separators && 'bg-[var(--color-surface-secondary)] px-6 py-5 lg:px-8'
            )}
          >
            {stat.name ? <span className={labelClass}>{stat.name}</span> : null}

            {hasChange ? (
              <span
                className={clsx(
                  'mb-1 h-4 text-xs font-medium tracking-tight tabular-nums',
                  stat.changeType === 'negative' ? 'text-accent-400' : 'text-zinc-400'
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
                {stat.suffix ? <span className="text-sm text-zinc-400">{stat.suffix}</span> : null}
              </div>
            )}

            {hasViz ? <div className="mt-2 w-full flex-none">{stat.viz ?? null}</div> : null}
            {hasHint ? (
              <span className={separators ? 'mt-2 text-xs text-zinc-500' : 'mt-1 text-xs text-zinc-400'}>
                {stat.hint ?? ' '}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
