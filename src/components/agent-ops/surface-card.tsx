import clsx from 'clsx'

import { Heading, Subheading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'

/**
 * Surface hierarchy — see `docs/surface-usage.md`. Tokens are NOT interchangeable:
 *
 *   Canvas (#000)  → page bg, AdminPageHeader, AgentKpiBand (naked, no wash)
 *   Section (#121214 / secondary) → SurfaceCard / AgentSectionCard / surfaceSectionClass
 *   Item (#1f1f22 / elevated) → surfaceItemClass
 *   Nav (#09090b / primary) → surfaceNavClass only
 *
 * Root bug (AIG-DS-SURFACE): section was painted `primary` and nav `secondary`
 * — inverted vs doctrine — so canvas + cards read as two muddy near-black layers.
 */

/** Level 2 — section panels (Projects, tables, workbench). MUST be secondary. */
export const surfaceSectionClass =
  'flex flex-col rounded-2xl bg-[var(--color-surface-secondary)] ring-1 ring-zinc-950/5 shadow-sm overflow-hidden'

/** Level 3 — interactive business objects (project row, agent card, KV tile). */
export const surfaceItemClass =
  'rounded-xl bg-[var(--color-surface-elevated)] ring-1 ring-zinc-950/5 shadow-sm shadow-black/5'

/** Navigation chrome — sidebar rail; quieter than sections (primary, not secondary). */
export const surfaceNavClass =
  'rounded-2xl bg-[var(--color-surface-primary)] ring-1 ring-zinc-950/5 overflow-hidden'

/** Backward-compatible alias — prefer `surfaceSectionClass` for new code. */
export const surfaceCardClass = surfaceSectionClass

export const surfaceSectionHeaderClass =
  'flex flex-wrap items-center justify-between gap-3 px-6 pt-4 pb-2'

/**
 * Micro-eyebrow — the tiny uppercase overline shared by `AdminPageHeader` and
 * the `AgentKpiBand` stat labels. ONE definition so the overline never drifts in
 * size/weight/tracking/colour between the page header and the KPI strip, and so a
 * layout flag (density/separators) can never change its TYPOGRAPHY — only its
 * surrounding geometry (min-height, margin). `zinc-400` clears WCAG AA at this
 * size on both the black canvas and a section fill; `zinc-500` does not.
 */
export const eyebrowClass = 'text-[10px] font-medium uppercase tracking-widest text-zinc-500'

/** @deprecated alias */
export const surfaceCardHeaderClass = surfaceSectionHeaderClass

export const surfaceCardFooterClass = 'pt-3'

/** Subtle inset within a section — not a full nested card. */
export const surfaceInsetClass =
  'rounded-xl bg-zinc-50 ring-1 ring-zinc-950/5'

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
    <section className={clsx(surfaceSectionClass, padding, className)}>
      {children}
    </section>
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
    <div className={clsx(surfaceSectionHeaderClass, className)}>
      <div className="min-w-0">
        <Subheading level={2} tone="neutral" className="tracking-tight text-zinc-900">
          {title}
        </Subheading>
        {description ? <Text className="mt-1 tracking-tight text-zinc-600">{description}</Text> : null}
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
    <header className={clsx('pb-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? <p className={eyebrowClass}>{eyebrow}</p> : null}
          {/* Canon DS: Catalyst Heading = text-2xl/8 (24px). Never text-3xl. */}
          <Heading className={clsx(eyebrow ? 'mt-1' : undefined, 'tracking-tight text-zinc-900')}>{title}</Heading>
          {description ? (
            <Text className="mt-1.5 max-w-3xl tracking-tight text-zinc-600">{description}</Text>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
      </div>
    </header>
  )
}

/**
 * Section card — thin wrapper over SurfaceCard + SurfaceCardHeader so workbench
 * and fleet pages share ONE section surface (no parallel paint path).
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
    <SurfaceCard className={className}>
      <SurfaceCardHeader title={title} description={description} actions={actions} />
      <div className={contentClassName ?? 'py-4'}>{children}</div>
    </SurfaceCard>
  )
}
