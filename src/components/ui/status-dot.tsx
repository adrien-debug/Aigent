import { cn } from './cn'

/**
 * Canonical "dot + label" status pattern — extracted from three byte-identical
 * implementations (`CheckStatusText` in release-panel.tsx, `StepStatusText` in
 * qualification-timeline.tsx, `PromotionStatusText` in promotion-evidence-panel.tsx).
 * All three mapped an arbitrary status enum to the same three visuals: a filled
 * accent dot for the positive outcome, a filled danger dot for the negative one,
 * and an unfilled ring for everything else (not measured / not configured /
 * pending / unavailable). The word always carried the distinction — the dot never
 * did alone — so `tone` alone is not a claim; `children` is required.
 */
const TONES = {
  /** The one filled, coloured-for-success dot. Reserve for a real pass/done outcome. */
  positive: { dot: 'bg-accent-500', text: 'text-accent-700 dark:text-accent-300' },
  /** The one filled, coloured-for-failure dot — the system's single non-accent hue. */
  negative: { dot: 'bg-[var(--state-danger-solid)]', text: 'text-[var(--state-danger-text)]' },
  /** Unfilled ring: nothing was measured yet, or the check does not apply. Never implies failure. */
  neutral: { dot: 'ring-1 ring-zinc-400 dark:ring-zinc-500', text: 'text-zinc-500 dark:text-zinc-400' },
  /** Filled zinc — actively running right now, distinct from both outcomes and from "not measured". */
  pending: { dot: 'bg-zinc-400 dark:bg-zinc-500', text: 'text-zinc-500 dark:text-zinc-400' },
} as const

export type StatusDotTone = keyof typeof TONES

const SIZES = {
  sm: { dot: 'size-1.5', text: 'text-xs', gap: 'gap-1.5' },
  md: { dot: 'size-2', text: 'text-sm', gap: 'gap-2' },
} as const

export type StatusDotSize = keyof typeof SIZES

export function StatusDot({
  tone,
  size = 'sm',
  className,
  srLabel,
  children,
}: {
  tone: StatusDotTone
  size?: StatusDotSize
  className?: string
  /** Overrides the label read to assistive tech; defaults to `children`. Use when
   * `children` is itself decorative or needs more context spoken than shown. */
  srLabel?: string
  children: React.ReactNode
}) {
  const { dot, text } = TONES[tone]
  const { dot: dotSize, text: textSize, gap } = SIZES[size]
  return (
    <span className={cn('inline-flex min-w-0 shrink-0 items-center', gap, textSize, className)}>
      <span aria-hidden="true" className={cn('shrink-0 rounded-full', dotSize, dot)} />
      <span className={cn('truncate', text)}>{children}</span>
      {srLabel ? <span className="sr-only">{srLabel}</span> : null}
    </span>
  )
}
