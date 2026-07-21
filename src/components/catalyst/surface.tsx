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

export const surfaceRaised =
  'rounded-xl bg-white shadow-lg ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:shadow-none dark:ring-white/10'

export const surfaceSunken =
  'rounded-xl bg-zinc-50/80 ring-1 ring-zinc-950/5 dark:bg-zinc-950/50 dark:ring-white/5'

export const surfaceHero =
  'rounded-xl bg-gradient-to-b from-zinc-50 to-white px-6 py-5 shadow-md ring-1 ring-zinc-950/10 dark:from-zinc-900 dark:to-zinc-900/60 dark:ring-white/10'

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
