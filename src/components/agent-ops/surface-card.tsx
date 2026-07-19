import clsx from 'clsx'

import { Subheading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'

/**
 * Surface hierarchy — three visual levels on the admin canvas:
 *
 * 1. Canvas (`--color-surface-canvas`) — page background, headers, KPI strips.
 * 2. Section (`surfaceSectionClass`) — functional panels (Projects, tables).
 * 3. Item (`surfaceItemClass`) — business objects (project row, agent card).
 *
 * Navigation chrome uses `surfaceNavClass` — lighter than content sections.
 */

/** Level 2 — section panels (Projects, Requires Attention, data tables). */
export const surfaceSectionClass =
  'rounded-2xl bg-[var(--color-surface-secondary)] border border-white/5 overflow-hidden'

/** Level 3 — interactive business objects (project row, agent card, KV tile). */
export const surfaceItemClass =
  'rounded-xl bg-[var(--color-surface-elevated)] border border-white/5'

/** Navigation chrome — sidebar rail; must not compete with content sections. */
export const surfaceNavClass =
  'rounded-2xl bg-[var(--color-surface-primary)] border border-white/[0.04] overflow-hidden'

/** Backward-compatible alias — prefer `surfaceSectionClass` for new code. */
export const surfaceCardClass = surfaceSectionClass

export const surfaceSectionHeaderClass =
  'flex flex-wrap items-center justify-between gap-3 border-b border-white/5'

/** @deprecated alias */
export const surfaceCardHeaderClass = surfaceSectionHeaderClass

export const surfaceCardFooterClass = 'border-t border-white/5'

/** Subtle inset within a section — not a full nested card. */
export const surfaceInsetClass =
  'rounded-xl bg-[var(--color-surface-elevated)]/50 border border-white/[0.04]'

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
    <div className={clsx(surfaceSectionClass, padding, className)}>
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
    <div className={clsx(surfaceSectionHeaderClass, 'px-6 py-4', className)}>
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
 * Canvas-level page header — title + optional description on the black canvas.
 * No enclosing card; separates from content with a hairline only.
 */
export function AdminPageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <header className={clsx('border-b border-white/5 pb-6', className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">{eyebrow}</p>
          ) : null}
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">{title}</h1>
          {description ? <p className="mt-2 max-w-3xl text-sm text-zinc-400">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
      </div>
    </header>
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
    <section className={clsx(surfaceSectionClass, className)}>
      <div className={clsx(surfaceSectionHeaderClass, 'px-6 py-4')}>
        <div className="flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap sm:items-start">
          <div className="min-w-0">
            <Subheading className="tracking-tight text-white">{title}</Subheading>
            {description ? <Text className="mt-1 tracking-tight">{description}</Text> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
        </div>
      </div>
      <div className={contentClassName ?? 'px-6 py-6'}>{children}</div>
    </section>
  )
}
