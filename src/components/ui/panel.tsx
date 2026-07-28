import { cn } from './cn'

/**
 * Surface grammar — imported from the Kyc design system (SHA 565f979,
 * `components/ui/surface.tsx`) and re-anchored on Aigent's dark ground.
 *
 * Three planes, same semantics as Kyc:
 * - `surfaceRaised`  — cards, tables, metrics, main panels
 * - `surfaceSunken`  — filters, secondary zones, dense lists, inner forms
 * - `surfaceOverlay` — dialogs, menus, tooltips
 *
 * Kyc's fourth plane, `surfaceHero` (page headers), is deliberately absent: no
 * Aigent page header ever consumed it, and a class string nothing imports is a
 * design decision that was never actually made here. Same for the `Band` and
 * `RowList` wrappers — they came over with the import and never found a caller.
 *
 * Kyc is light-first with `dark:` overrides; Aigent forces `.dark` on <html>, so
 * only the dark half ever paints. The light half is kept verbatim from Kyc so the
 * two repos stay diffable and a light theme remains one class-flip away.
 */

/**
 * Plane 2 — panels: charts, tables, lists, metrics.
 *
 * Dark mode keeps a real cast shadow plus a 1px top highlight. Kyc shipped
 * `dark:shadow-none`, which is what made every card sit perfectly flat on the
 * page: with no shadow AND a near-identical fill, nothing separated a panel
 * from the ground behind it.
 */
export const surfaceRaised =
  'rounded-xl bg-white shadow-lg ring-1 ring-zinc-950/10 dark:bg-surface-raised dark:shadow-[var(--surface-shadow),var(--surface-highlight)] dark:ring-[var(--surface-border)]'

/** Plane 3 — insets: filters, table headers, legends, secondary summaries. Reads recessed: DARKER than the panel holding it. */
export const surfaceSunken =
  'rounded-xl bg-zinc-50/80 ring-1 ring-zinc-950/5 dark:bg-surface-sunken dark:ring-[var(--surface-border)]'

/** Plane 4 — dialogs, menus, tooltips. Opaque and lifted above every panel. */
export const surfaceOverlay =
  'rounded-xl bg-white shadow-xl ring-1 ring-zinc-950/10 dark:bg-surface-overlay dark:shadow-[var(--surface-shadow-strong)] dark:ring-[var(--surface-border-strong)]'

export function Panel({
  as: Component = 'div',
  className,
  inset = 'md',
  tone = 'raised',
  ...props
}: {
  /** Element the surface renders as. `Panel` is the ONLY place that decides
   * fill/border/radius/shadow for the raised and sunken planes — a caller that
   * needs `<section>` semantics (e.g. `SectionSurface`) composes this instead
   * of restating the paint. */
  as?: 'div' | 'section'
  inset?: 'none' | 'sm' | 'md' | 'lg'
  tone?: 'raised' | 'sunken'
} & React.ComponentPropsWithoutRef<'div'>) {
  return (
    <Component
      {...props}
      className={cn(
        tone === 'raised' ? surfaceRaised : surfaceSunken,
        inset === 'sm' && 'p-4',
        inset === 'md' && 'p-6',
        inset === 'lg' && 'p-8',
        className,
      )}
    />
  )
}
