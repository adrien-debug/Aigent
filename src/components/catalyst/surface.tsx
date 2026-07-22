import clsx from 'clsx'

/**
 * Surface grammar — imported from the Kyc design system (SHA 565f979,
 * `components/ui/surface.tsx`) and re-anchored on Aigent's dark ground.
 *
 * Three planes, same semantics as Kyc:
 * - `surfaceRaised` — cards, tables, metrics, main panels
 * - `surfaceSunken` — filters, secondary zones, dense lists, inner forms
 * - `surfaceHero`   — page headers
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

/** Page entry — a raised plane with a very subtle vertical gradient, never a decorative banner. */
export const surfaceHero =
  'rounded-xl bg-gradient-to-b from-zinc-50 to-white px-6 py-5 shadow-md ring-1 ring-zinc-950/10 dark:from-surface-raised dark:to-surface-workspace dark:shadow-[var(--surface-shadow),var(--surface-highlight)] dark:ring-[var(--surface-border)]'

/** Plane 4 — dialogs, menus, tooltips. Opaque and lifted above every panel. */
export const surfaceOverlay =
  'rounded-xl bg-white shadow-xl ring-1 ring-zinc-950/10 dark:bg-surface-overlay dark:shadow-[var(--surface-shadow-strong)] dark:ring-[var(--surface-border-strong)]'

export function Band({
  className,
  divided = true,
  ...props
}: { divided?: boolean } & React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className={clsx(
        className,
        divided && 'border-t border-zinc-950/10 pt-8 dark:border-white/10',
        surfaceSunken,
        'p-5 sm:p-6',
      )}
    />
  )
}

export function Panel({
  className,
  inset = 'md',
  tone = 'raised',
  ...props
}: {
  inset?: 'none' | 'sm' | 'md' | 'lg'
  tone?: 'raised' | 'sunken'
} & React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className={clsx(
        className,
        tone === 'raised' ? surfaceRaised : surfaceSunken,
        inset === 'sm' && 'p-4',
        inset === 'md' && 'p-6',
        inset === 'lg' && 'p-8',
      )}
    />
  )
}

export function RowList({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className={clsx(
        className,
        surfaceRaised,
        'divide-y divide-zinc-950/5 px-3 dark:divide-white/5 sm:px-4',
      )}
    />
  )
}
