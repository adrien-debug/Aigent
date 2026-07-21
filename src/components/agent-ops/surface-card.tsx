import clsx from 'clsx'

import { Heading, Subheading } from '@/components/catalyst/heading'
import { surfaceRaised, surfaceSunken } from '@/components/catalyst/surface'
import { Text } from '@/components/catalyst/text'

/**
 * Surface hierarchy — now a THIN ALIAS over the Kyc grammar in
 * `@/components/catalyst/surface`, which is the single implementation:
 *
 *   surfaceSectionClass → surfaceRaised  (cards, tables, metrics, panels)
 *   surfaceItemClass    → surfaceSunken  (rows, tiles, dense/secondary zones)
 *
 * Aliased rather than deleted so the ~50 existing importers converge on the Kyc
 * surfaces in one step instead of a 50-file rename. Prefer importing
 * `surfaceRaised` / `surfaceSunken` / `Panel` / `Band` / `RowList` directly in
 * new code; these names are the migration shim, not a parallel system.
 *
 * The `--color-surface-*` tokens these used to paint were a second, competing
 * source of truth for the same three planes. The Kyc classes carry their own
 * dark values, so the tokens no longer gate the look.
 */

/** Level 2 — section panels (Projects, tables, workbench). */
export const surfaceSectionClass = `flex flex-col overflow-hidden ${surfaceRaised}`

/** Level 3 — interactive business objects (project row, agent card, KV tile). */
export const surfaceItemClass = surfaceSunken

/**
 * Navigation chrome. The sidebar is now Catalyst `SidebarLayout`, which paints
 * its own container (see the `lg:` rule in globals.css), so this no longer has a
 * rail to dress — kept only until the last legacy importer is gone.
 * @deprecated
 */
export const surfaceNavClass = surfaceSunken

/** Backward-compatible alias — prefer `surfaceSectionClass` for new code. */
export const surfaceCardClass = surfaceSectionClass

/**
 * Header geometry, split in two so padding stays DECIDABLE by the caller.
 *
 * A local `className="px-4"` does NOT override the default `px-6`: two utilities
 * of the same property have the same specificity, so the winner is the one Tailwind
 * emits LAST in the stylesheet (`.px-4` line 3232 < `.px-6` line 3240) — never the
 * one written last in the class attribute. Passing padding through `className` was
 * therefore a silent no-op. Choose the geometry with `density`, never with `px-*`.
 */
const surfaceSectionHeaderStructureClass = 'flex shrink-0 flex-wrap items-center justify-between gap-3'

const SURFACE_HEADER_DENSITY = {
  /** Section default — matches the `px-6` gutter of full-page section cards. */
  comfortable: 'px-6 pt-4 pb-2',
  /** Cockpit cards — 16px, aligned with the 16px content gutter of their rows/cells. */
  compact: 'px-4 pt-4 pb-3',
} as const

export type SurfaceHeaderDensity = keyof typeof SURFACE_HEADER_DENSITY

export const surfaceSectionHeaderClass = `${surfaceSectionHeaderStructureClass} ${SURFACE_HEADER_DENSITY.comfortable}`

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
  'rounded-xl bg-zinc-50 ring-1 ring-zinc-950/5 dark:bg-white/5 dark:ring-white/10'

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
  density = 'comfortable',
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  meta?: React.ReactNode
  /** Horizontal gutter of the header. MUST align with the card body's own gutter. */
  density?: SurfaceHeaderDensity
  /** Non-padding extras only — see `surfaceSectionHeaderClass` for why `px-*` here is a no-op. */
  className?: string
}) {
  return (
    <div className={clsx(surfaceSectionHeaderStructureClass, SURFACE_HEADER_DENSITY[density], className)}>
      <div className="min-w-0">
        <Subheading level={2} tone="neutral" className="tracking-tight text-zinc-900 dark:text-white">
          {title}
        </Subheading>
        {description ? <Text className="mt-1 tracking-tight text-zinc-600 dark:text-zinc-400">{description}</Text> : null}
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
          <Heading className={clsx(eyebrow ? 'mt-1' : undefined, 'tracking-tight text-zinc-900 dark:text-white')}>
            {title}
          </Heading>
          {description ? (
            <Text className="mt-1.5 max-w-3xl tracking-tight text-zinc-600 dark:text-zinc-400">{description}</Text>
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
