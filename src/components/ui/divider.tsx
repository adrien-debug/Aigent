import { cn, responsiveDefault } from './cn'

/**
 * Catalyst `Divider`, ported from the official kit. Two changes, both from
 * `./cn`: the caller's `className` goes LAST, and the light/dark colour pair is
 * emitted through `responsiveDefault` so a hairline restyled to a project token
 * (`border-line`) actually lands. Without that second step the bare caller
 * class only beats the LIGHT half — `dark:border-white/10` survives, and dark
 * is the only branch that ever renders here, so the override would be inert.
 * Measured: `twMerge('border-zinc-950/10 dark:border-white/10', 'border-line')`
 * keeps `dark:border-white/10`.
 */
export function Divider({
  soft = false,
  className,
  ...props
}: { soft?: boolean } & React.ComponentPropsWithoutRef<'hr'>) {
  return (
    <hr
      role="presentation"
      {...props}
      className={cn(
        'w-full border-t',
        responsiveDefault(
          soft ? 'border-zinc-950/5' : 'border-zinc-950/10',
          soft ? 'dark:border-white/5' : 'dark:border-white/10',
          className
        ),
        className
      )}
    />
  )
}
