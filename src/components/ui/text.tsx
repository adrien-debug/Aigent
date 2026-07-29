import { cn, responsiveDefault } from './cn'

/**
 * Font-size ladder — a PROP, not a `className`. `tailwind-merge` cannot beat a
 * `sm:`-scoped default with a bare caller class, so the responsive default is
 * dropped once the caller declares its own size instead of being overridden
 * only above the breakpoint. See `./cn` (`responsiveDefault`).
 */
const TEXT_SIZES = {
  body: { base: 'text-sm/6', bump: 'max-sm:text-base/6' },
} as const satisfies Record<string, { base: string; bump?: string }>

/**
 * Colour ladder — also a PROP, for the same reason: a `dark:` default
 * survives a light-only override, so a caller restyling the colour must name
 * the role here rather than pass a bare class.
 */
const TEXT_TONES = {
  muted: 'text-zinc-500 dark:text-zinc-400',
} as const

type TextProps = {
  size?: keyof typeof TEXT_SIZES
  tone?: keyof typeof TEXT_TONES
} & React.ComponentPropsWithoutRef<'p'>

export function Text({ className, size = 'body', tone = 'muted', ...props }: TextProps) {
  const { base, bump } = TEXT_SIZES[size]
  return (
    <p
      data-slot="text"
      {...props}
      // Defaults FIRST, caller LAST — see ./cn for why the order in this call
      // is the only thing that decides who wins.
      className={cn(responsiveDefault(base, bump, className), TEXT_TONES[tone], className)}
    />
  )
}
