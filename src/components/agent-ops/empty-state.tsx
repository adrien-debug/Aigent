import clsx from 'clsx'

import { Subheading } from '@/components/ui/heading'
import { surfaceRaised } from '@/components/ui/panel'
import { Text } from '@/components/ui/text'

/**
 * EmptyState — the ONE empty-state grammar for /admin screens (canon fixed by
 * DS audit: 5 different copy-pasted empty-state markups were found across the
 * repo). Centered, generous padding, discrete zinc icon, NEUTRAL title (this
 * is an empty state, not a section title — no accent orange), zinc-500
 * description, optional action slot for a follow-up button/link.
 *
 * Callers own the surrounding surface (card/section wrapper); this component
 * only lays out the centered content block, matching the `px-6 py-12` rhythm
 * used by every empty state in the repo today.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<React.ComponentProps<'svg'>>
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={clsx('px-6 py-12', className)}>
      <div className="mx-auto max-w-md text-center">
        {Icon ? <Icon aria-hidden="true" className="mx-auto size-10 text-zinc-500" /> : null}
        <Subheading tone="neutral" className={clsx(Icon && 'mt-4', 'text-zinc-900 dark:text-white')}>
          {title}
        </Subheading>
        {description ? <Text className="mt-2 text-zinc-600">{description}</Text> : null}
        {action ? <div className="mt-6 flex flex-wrap justify-center gap-3">{action}</div> : null}
      </div>
    </div>
  )
}

/**
 * EmptyStatePanel — `EmptyState` plus the surface it stands on.
 *
 * `EmptyState` deliberately owns no surface, which left every caller to write
 * its own wrapper. Ten of them converged on the same hand-rolled string —
 * `rounded-2xl border border-dashed border-white/5 bg-white/[0.01]` — a dashed
 * hairline at 5% over a 1% fill. On the dark ground that is very close to
 * invisible: the panel does not separate from the page, so a legitimately empty
 * section reads as a rendering failure rather than a deliberate state.
 *
 * This wraps the same content in the real `surfaceRaised` plane, so an empty
 * panel occupies the SAME visual slot as the populated panel it replaces —
 * the page keeps its structure whether or not there is data. Use this whenever
 * an empty state stands in for a card; use bare `EmptyState` only when the
 * caller already provides a surface (e.g. inside an existing `Section`).
 *
 * `className` lands on the SURFACE, not on the inner content. It used to go to
 * the content, which made the surface unreachable: five callers mounted this
 * inside a `Section` — a surface already — and tried to cancel the doubled plane
 * with `className="border-0 bg-transparent"`. That string reached a content div
 * that had neither a border nor a background, so it did nothing at all while
 * looking like it had; the ring, the shadow and the rounded fill kept painting a
 * card inside a card. Those callers now use bare `EmptyState`, and routing
 * `className` here means the next attempt to restyle the plane actually bites.
 */
export function EmptyStatePanel({
  className,
  ...props
}: React.ComponentProps<typeof EmptyState>) {
  return (
    <div className={clsx(surfaceRaised, className)}>
      <EmptyState {...props} />
    </div>
  )
}

/**
 * NotMeasuredDash — the cell-level counterpart of EmptyState: a dimension that
 * was never measured renders "—", NEVER a 0. Zero asserts "a run looked and
 * found none"; absence of measurement asserts nothing. Any table/matrix cell
 * fed a `null` metric must use this rather than coercing to a number.
 *
 * Screen readers get "not measured" — the em dash alone is silent.
 */
export function NotMeasuredDash() {
  return (
    <span className="text-zinc-400">
      <span aria-hidden="true">—</span>
      <span className="sr-only">not measured</span>
    </span>
  )
}
