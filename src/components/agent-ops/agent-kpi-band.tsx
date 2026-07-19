import clsx from 'clsx'

import { AnimatedNumber } from '@/components/agent-ops/animated-number'
import { surfaceKpiBandClass } from '@/components/agent-ops/surface-card'

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

// Canon DS (`Heading`): page H1 is text-2xl/8 (24px). KPI values must never
// exceed that — hero matches H1; compact/small sit clearly below.
const VALUE_SIZE_CLASS = {
  hero: 'font-mono text-2xl/8 font-light tracking-tight',
  compact: 'font-mono text-xl/7 font-light tracking-tight',
  small: 'font-mono text-lg/6 font-light tracking-tight',
} as const

const VALUE_TONE_CLASS = {
  default: 'text-white',
  accent: 'text-accent-400',
  muted: 'text-zinc-400',
} as const

/**
 * KPI band — single canon for all dashboard pages and agent sub-tabs.
 * Default: stats on `surfaceKpiBandClass` (secondary panel on canvas).
 * Accent reserved for emphasis only.
 *
 * `separators` (opt-in): hairline dividers between stats via the `gap-px`
 * grid technique. Cell fill defaults to canvas — use inside a section card
 * only when the parent already provides `surface-secondary`.
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
    ? 'flex min-h-7 items-start text-[10px] font-medium uppercase tracking-widest text-zinc-500 mb-2 transition-colors group-hover:text-zinc-400'
    : density === 'compact'
      ? 'flex min-h-7 items-start text-[10px] font-medium uppercase tracking-widest text-zinc-400 mb-1'
      : 'flex min-h-8 items-start text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1.5 group-hover:text-zinc-300 transition-colors'

  return (
    <div
      className={clsx(
        // Metrics are not prose — block accent text-selection wash that reads
        // as a false "green surface" on the first hovered/dragged columns.
        'grid select-none grid-cols-1 sm:grid-cols-2',
        separators
          ? 'gap-px bg-white/5'
          : [
              surfaceKpiBandClass,
              density === 'compact' ? 'mb-6 gap-x-4 gap-y-2 px-3 py-3' : 'mb-6 gap-4 px-4 py-4',
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
              'group flex h-full flex-col rounded-lg',
              // Full column hit-target: padding lives on the cell so hover fills
              // the grid track, not a flush box around the text.
              separators
                ? 'bg-[var(--color-surface-canvas)] px-6 py-5 lg:px-8'
                : 'cursor-default px-3 py-2.5 transition-colors hover:bg-[var(--color-surface-interactive)]'
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
