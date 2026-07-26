import { cn } from '@/components/ui/cn'
import { Subheading } from '@/components/ui/heading'
import { surfaceRaised } from '@/components/ui/panel'
import { Text } from '@/components/ui/text'

/**
 * Section — generic panel-with-header primitive, extracted from
 * `agent-ops/surface-card.tsx` (`AgentSectionCard`). Thin wrapper over
 * `surfaceRaised` (Panel's "raised" plane) + `SectionHeader` so every section
 * card in the dashboard shares ONE paint path.
 */

/** Level 2 — section panels (Projects, tables, workbench). */
export const surfaceSectionClass = `flex flex-col overflow-hidden ${surfaceRaised}`

/**
 * Header geometry, split in two so padding stays DECIDABLE by the caller.
 *
 * HISTORY, because the reason this split exists has changed. A local
 * `className="px-4"` used to be a silent no-op: two utilities of the same
 * property have the same specificity, so the winner was the one Tailwind emits
 * LAST in the stylesheet (`.px-4` line 3232 < `.px-6` line 3240), never the one
 * written last in the class attribute. Since `./cn` (tailwind-merge) composes
 * every primitive, the loser is now DROPPED before the browser sees it and a
 * caller's `px-4` does land.
 *
 * `density` remains the lever to use anyway: it names the two gutters the
 * dashboard actually has and keeps a header aligned with its card body, which a
 * one-off `px-*` at a call site cannot promise.
 */
const surfaceSectionHeaderStructureClass = 'flex shrink-0 flex-wrap items-center justify-between gap-3'

export const SURFACE_HEADER_DENSITY = {
  /** Section default — matches the `px-6` gutter of full-page section cards. */
  comfortable: 'px-6 pt-4 pb-2',
  /** Cockpit cards — 16px, aligned with the 16px content gutter of their rows/cells. */
  compact: 'px-4 pt-4 pb-3',
} as const

export type SurfaceHeaderDensity = keyof typeof SURFACE_HEADER_DENSITY

export const surfaceSectionHeaderClass = `${surfaceSectionHeaderStructureClass} ${SURFACE_HEADER_DENSITY.comfortable}`

function SectionSurface({
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
    <section className={cn(surfaceSectionClass, padding, className)}>
      {children}
    </section>
  )
}

export function SectionHeader({
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
  /** Extras. `px-*` now lands (see above), but `density` is the aligned choice. */
  className?: string
}) {
  return (
    <div className={cn(surfaceSectionHeaderStructureClass, SURFACE_HEADER_DENSITY[density], className)}>
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
 * Section — thin wrapper over the raised surface + SectionHeader so workbench
 * and fleet pages share ONE section surface (no parallel paint path).
 */
export function Section({
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
    <SectionSurface className={className}>
      <SectionHeader title={title} description={description} actions={actions} />
      <div className={contentClassName ?? 'py-4'}>{children}</div>
    </SectionSurface>
  )
}
