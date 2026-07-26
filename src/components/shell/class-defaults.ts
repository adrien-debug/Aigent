/**
 * Why this file exists: `clsx(defaults, className)` does NOT let a caller
 * override a default.
 *
 * Tailwind arbitrates two conflicting utilities by their position in the
 * COMPILED STYLESHEET, never by their position in the `class` attribute. Both
 * `pb-0` and `pb-4` are emitted; `pb-4` is emitted later (the padding scale is
 * sorted by value), so it wins wherever both are present — measured on
 * `<PageHeader className="pb-0">`, which rendered `padding-bottom: 16px`.
 * The override is not "weak", it is DEAD, and it lies to whoever reads the
 * call site.
 *
 * A merge library (tailwind-merge) is the usual answer; this repo does not ship
 * one and adding a dependency is not this layer's call. So the shell layers do
 * the one thing that is provably correct without a dependency: they do not
 * EMIT a default the caller has already spoken for.
 *
 * Scope note: this is deliberately NOT a general-purpose merger. It answers a
 * single question — "did the caller already state this utility family?" — for
 * the handful of geometry defaults the shell owns (page padding, page gap).
 * Colour/typography defaults live in `src/components/ui/` primitives and are
 * fixed there, by prop or by removal, not here.
 */

/**
 * True when `className` already contains an UNCONDITIONAL utility from one of
 * `families`.
 *
 * Two rules make the answer safe to act on:
 *
 *  - A family matches its own shorthands, because they set the same property:
 *    a `pb-*` default must stand down for `pb-0`, `py-0` AND `p-0`. The caller
 *    passes the full list; nothing is inferred here.
 *  - A variant-qualified utility (`sm:pb-0`, `dark:gap-8`) NEVER suppresses an
 *    unconditional default — it only applies under its condition, so dropping
 *    the default would leave the property unset everywhere else.
 */
export function callerSets(className: string | undefined, families: readonly string[]): boolean {
  if (!className) return false

  return className.split(/\s+/).some((token) => {
    if (token === '' || token.includes(':')) return false
    // Negative utilities (`-mt-2`) start with the dash; the family is what
    // follows it, and we never own a negative geometry default anyway.
    const utility = token.startsWith('-') ? token.slice(1) : token
    return families.some((family) => utility === family || utility.startsWith(`${family}-`))
  })
}

/**
 * Utility families that decide `padding-bottom`, longest-lived first. Used by
 * every shell layer that ships a bottom-padding default.
 */
export const PADDING_BOTTOM_FAMILIES = ['pb', 'py', 'p'] as const

/** Utility families that decide the flex/grid gap. */
export const GAP_FAMILIES = ['gap'] as const
