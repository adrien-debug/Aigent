import clsx from 'clsx'

import { AnimatedNumber } from '@/components/agent-ops/animated-number'
import { eyebrowClass } from '@/components/agent-ops/surface-card'

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
  hero: 'text-2xl/8 font-light tracking-tight tabular-nums',
  compact: 'text-xl/7 font-light tracking-tight tabular-nums',
  small: 'text-lg/6 font-light tracking-tight tabular-nums',
} as const

const VALUE_TONE_CLASS = {
  default: 'text-white',
  accent: 'text-accent-400',
  muted: 'text-zinc-400',
} as const

/**
 * KPI band — single canon for all dashboard pages and agent sub-tabs.
 * Default: stats NAKED on the black canvas (no card wash) — per doctrine a KPI
 * strip is canvas-level chrome, never a panel. Accent reserved for emphasis only.
 *
 * `separators` (opt-in): hairline dividers between stats via the `gap-px`
 * grid technique — use inside a section card only when the parent already
 * provides `surface-secondary`.
 */
export function AgentKpiBand({
  stats,
  className,
  density = 'default',
  separators = false,
  flush = false,
}: {
  stats: AgentKpiStat[]
  className?: string
  density?: 'default' | 'compact'
  /** Hairline separators between stats; padding moves into the cells. */
  separators?: boolean
  /** Remove the band's internal bottom margin for compact page composition. */
  flush?: boolean
}) {
  const hasChange = stats.some((stat) => stat.change)
  const hasViz = stats.some((stat) => stat.viz)
  const hasHint = stats.some((stat) => stat.hint)

  const defaultValueSize = density === 'compact' ? 'compact' : 'hero'
  // Reserve a fixed two-line height for the label so a title that wraps
  // ("24H COMPUTE COST") does not push its value lower than its one-line
  // neighbours — every value row then starts on the same baseline.
  // Typography is FIXED (the shared `eyebrowClass`); only the surrounding
  // geometry (reserved height + bottom margin) tracks density/separators, so a
  // layout flag can never change the label's size/weight/tracking/colour.
  const labelClass = clsx(
    'flex items-start',
    eyebrowClass,
    separators ? 'min-h-7 mb-2' : flush ? 'min-h-6 mb-0.5' : density === 'compact' ? 'min-h-7 mb-1' : 'min-h-8 mb-1.5'
  )

  return (
    <div
      className={clsx(
        // Metrics are not prose — block accent text-selection wash that reads
        // as a false "green surface" on the first hovered/dragged columns.
        'grid select-none grid-cols-1 sm:grid-cols-2',
        separators
          // One raised panel split into cells by hairline gaps: the gap colour
          // shows through as the divider, so there is a single surface rather
          // than N floating boxes.
          ? 'gap-px overflow-hidden rounded-xl bg-zinc-950/10 ring-1 ring-zinc-950/10 shadow-sm dark:bg-[var(--surface-border)] dark:ring-[var(--surface-border)] dark:shadow-[var(--surface-shadow),var(--surface-highlight)]'
          : density === 'compact'
            ? clsx(!flush && 'mb-6', 'gap-x-4 gap-y-2')
            : clsx(!flush && 'mb-6', 'gap-4'),
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
              // No radius here: in `separators` mode the cell is squared off by
              // `rounded-none` below (the band's own `rounded-xl` does the
              // corners), and in the default mode the cell has no background,
              // ring or clipping — a radius on a fully transparent box paints
              // nothing. The `rounded-lg` that used to sit here was inert in
              // both branches.
              'group flex h-full flex-col',
              // Full column hit-target: padding lives on the cell so hover fills
              // the grid track, not a flush box around the text.
              separators
                // Cell fill = the raised plane; the 1px gap between cells is the
                // panel's own background showing through as a divider. Padding
                // steps down on small screens, where the cells stack and a 24px
                // gutter eats the width the values need.
                ? 'rounded-none bg-white px-4 py-4 sm:px-6 sm:py-5 lg:px-8 dark:bg-surface-raised'
                : 'cursor-default px-3 py-2.5'
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
