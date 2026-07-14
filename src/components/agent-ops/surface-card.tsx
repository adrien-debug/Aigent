import clsx from 'clsx'

import { Subheading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'

/** Canon surface shell — Command Center premium pass. */
export const surfaceCardClass =
  'rounded-2xl bg-[var(--color-surface-secondary)] border border-white/5 overflow-hidden'

export const surfaceCardHeaderClass =
  'flex items-center justify-between border-b border-white/5 bg-black/20'

export const surfaceInsetClass = 'rounded-xl bg-black/20 border border-white/5'

export function SurfaceCard({
  children,
  className,
  padding,
}: {
  children: React.ReactNode
  className?: string
  /** When set, adds uniform padding instead of relying on children. */
  padding?: string
}) {
  return (
    <div className={clsx(surfaceCardClass, padding, className)}>
      {children}
    </div>
  )
}

export function SurfaceCardHeader({
  title,
  description,
  actions,
  meta,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  meta?: React.ReactNode
  className?: string
}) {
  return (
    <div className={clsx(surfaceCardHeaderClass, 'p-4', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {description ? <p className="mt-1 text-xs text-zinc-400">{description}</p> : null}
      </div>
      {meta ?? actions ? (
        <div className="flex shrink-0 items-center gap-3">
          {meta}
          {actions}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Section card — Catalyst header rhythm on premium surfaces.
 * Replaces the old white/ring shell; use for workbench sections and agent tabs.
 */
export function AgentSectionCard({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <section className={clsx(surfaceCardClass, className)}>
      <div className={clsx(surfaceCardHeaderClass, 'px-6 py-4')}>
        <div className="-mt-2 -ml-4 flex flex-wrap items-center justify-between sm:flex-nowrap sm:items-start">
          <div className="mt-2 ml-4 flex min-w-0 items-start gap-3">
            <div className="min-w-0">
              <Subheading className="tracking-tight text-white">{title}</Subheading>
              {description ? <Text className="mt-1 tracking-tight">{description}</Text> : null}
            </div>
          </div>
          {actions ? <div className="mt-2 ml-4 flex shrink-0 items-center gap-3">{actions}</div> : null}
        </div>
      </div>
      <div className={contentClassName ?? 'px-6 py-6'}>{children}</div>
    </section>
  )
}
