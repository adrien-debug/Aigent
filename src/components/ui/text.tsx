import { cn, responsiveDefault } from './cn'

/**
 * Font-size ladder — a PROP, not a `className`.
 *
 * The Catalyst default was written `text-base/6 sm:text-sm/6`: 16px on phones,
 * 14px from 640px up. The desktop value therefore lived behind a `sm:` variant,
 * and a variant-scoped rule can only be beaten by another rule carrying the SAME
 * variant. `<Text className="text-xs">` — 26 occurrences in this dashboard —
 * measured 14px at 1440px, not 12px, and plain `tailwind-merge` cannot repair it.
 *
 * `body` states the SAME two sizes with the halves swapped — `base` is the value
 * a caller class competes against, `bump` the complementary media query — and
 * `responsiveDefault` (./cn) drops the bump as soon as the caller declares its
 * own size, so the override lands at EVERY width instead of at one of the two.
 *
 * The other rungs are deliberately FLAT: asking for `xs` is an explicit editorial
 * choice ("this is a footnote"), not a request for a responsive ramp.
 */
const TEXT_SIZES = {
  /** Catalyst body — 16px under 640px, 14px above. The historical default. */
  body: { base: 'text-sm/6', bump: 'max-sm:text-base/6' },
  /** 14px flat — body size without the phone bump. */
  sm: { base: 'text-sm/6' },
  /** 12px flat — the dashboard's footnote size. */
  xs: { base: 'text-xs/5' },
  /** 11px flat — provenance lines, monospace metadata. The floor. */
  '2xs': { base: 'text-[11px]/4' },
} as const satisfies Record<string, { base: string; bump?: string }>

/**
 * The dashboard's 11px rung as a plain class string — for the `<span>`,
 * `<code>`, `<div>`, `<dt>` sites that carry this role but aren't a `<p>`
 * (`Text` only renders one). Per DESIGN-DOCTRINE.md §Typo: "provenance
 * lines, monospace metadata" — declared, not tolerated, and previously
 * "written by hand, no tool guarding it" everywhere outside `Text`. Same
 * literal as `TEXT_SIZES['2xs'].base` so the two never drift apart; unlike
 * a caller writing `text-[11px]` directly against a `<Text size="body">`
 * (which loses to the primitive's own `sm:text-sm/6` — see the ladder
 * comment above), a plain sibling element has no competing rule to lose to.
 */
export const metaTextClass = TEXT_SIZES['2xs'].base

/**
 * Colour ladder — also a PROP, for the second half of the same defect.
 *
 * `tailwind-merge` drops a bare default when the caller passes a bare class, but
 * a `dark:` default survives a light-only override: `cn('text-zinc-500
 * dark:text-zinc-400', 'text-zinc-100')` still paints zinc-400 in dark mode, and
 * this app forces `.dark` on <html>. A caller restyling the colour must either
 * pass BOTH halves or — better — name the role here.
 */
const TEXT_TONES = {
  /** Secondary copy. The historical default; zinc-400 in dark clears AA on every plane. */
  muted: 'text-zinc-500 dark:text-zinc-400',
  /** Primary copy — same weight as the surrounding text, full contrast. */
  strong: 'text-zinc-950 dark:text-white',
} as const

type TextProps = {
  size?: keyof typeof TEXT_SIZES
  tone?: keyof typeof TEXT_TONES
} & React.ComponentPropsWithoutRef<'p'>

export function Text({ className, size = 'body', tone = 'muted', ...props }: TextProps) {
  const { base, bump } = { bump: undefined, ...TEXT_SIZES[size] }
  return (
    <p
      data-slot="text"
      {...props}
      // Defaults FIRST, caller LAST — the inverse of the kit's original
      // `clsx(className, …)`. See `./cn` for why the order in this call is the
      // only thing that decides who wins.
      className={cn(responsiveDefault(base, bump, className), TEXT_TONES[tone], className)}
    />
  )
}

export function Strong({ className, ...props }: React.ComponentPropsWithoutRef<'strong'>) {
  return <strong {...props} className={cn('font-medium text-zinc-950 dark:text-white', className)} />
}
