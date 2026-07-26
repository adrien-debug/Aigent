import clsx from 'clsx'

import { surfaceSunken } from '@/components/ui/panel'
import { surfaceSectionClass, surfaceSectionHeaderClass } from '@/components/ui/section'

/**
 * Formal legacy bridge — the remaining deprecated aliases that used to live
 * directly in `agent-ops/surface-card.tsx`. `surface-card.tsx` is now a pure
 * re-export shim (see that file); this module holds the actual definitions so
 * the ~50 existing importers keep working unchanged during the migration.
 *
 * Prefer importing `surfaceRaised` / `surfaceSunken` / `surfaceOverlay` /
 * `Panel` from `@/components/ui/panel`, or `Section` / `SectionHeader` from
 * `@/components/ui/section` directly in new code. These names are the
 * migration shim, not a parallel system.
 */

/** Level 3 — interactive business objects (project row, agent card, KV tile). */
export const surfaceItemClass = surfaceSunken

/** Backward-compatible alias — prefer `surfaceSectionClass` from `@/components/ui/section` for new code. */
export const surfaceCardClass = surfaceSectionClass

/** @deprecated alias — prefer `surfaceSectionHeaderClass` from `@/components/ui/section` for new code. */
export const surfaceCardHeaderClass = surfaceSectionHeaderClass

export const surfaceCardFooterClass = 'pt-3'

/** Subtle inset within a section — not a full nested card. */
export const surfaceInsetClass =
  'rounded-xl bg-zinc-50 ring-1 ring-zinc-950/5 dark:bg-white/5 dark:ring-white/10'

/** @deprecated moved here from `agent-ops/surface-card.tsx` — prefer `Section`/`Panel` for new code. */
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
