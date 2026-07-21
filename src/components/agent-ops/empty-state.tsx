import clsx from 'clsx'

import { Subheading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'

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
