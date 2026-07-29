import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * `cn` — the class composer every primitive of `src/components/ui/` must use,
 * with the caller's `className` passed LAST.
 *
 * WHY IT EXISTS. The kit shipped `clsx(className, 'defaults…')`: the caller's
 * string first, the primitive's defaults after. That reads like "the caller can
 * override" and it is false. Two utilities writing the same CSS property have
 * the SAME specificity, so the winner is the one Tailwind emits LAST in the
 * COMPILED STYLESHEET — never the one written last in the `class` attribute.
 * `.py-3` is emitted before `.py-4`, so `<TableCell className="py-3">` rendered
 * 16px; `.px-0` before `.px-1.5`, so `<Badge className="px-0">` kept its padding.
 * 83 overrides across the dashboard were inert this way, and nothing warned —
 * `node scripts/check-class-collision.mjs` was written to enumerate them.
 *
 * WHAT IT FIXES. `twMerge` resolves the conflict in JS, before the browser ever
 * sees the class list: of two classes in the same conflict group it DROPS the
 * earlier one, so the last one written — the caller's — is the only one emitted.
 * No cascade arbitration left to lose.
 *
 * WHAT IT DOES NOT FIX — read this before assuming an override now works.
 * `twMerge` only merges classes that share BOTH the conflict group AND the
 * variant set. Two consequences the primitives here have to design around:
 *
 *   1. A default behind a variant is untouchable from a bare caller class.
 *      `twMerge('text-base/6 sm:text-sm/6', 'text-xs')` keeps `sm:text-sm/6`,
 *      so the text still renders 14px from 640px up. `responsiveDefault` below
 *      is the answer to that one; the prop route (`size`/`tone` on `Text`,
 *      `size` on `Badge`, `density` on `SectionHeader`, `dense` on `Table`)
 *      stays the readable way to ask for a rung by name.
 *   2. `dark:` defaults survive a light-only caller class. A caller that means
 *      to restyle a colour must pass the `dark:` half too, or use `tone`.
 *
 * IMPORTANT MARKERS. `tailwind-merge` v3 reads the Tailwind v4 SUFFIX form
 * (`text-xs!`) and ignores the v3 PREFIX form (`!text-xs`). Tailwind v4 compiles
 * both, and `!important` beats stylesheet order on its own, so both are safe —
 * but only the suffix form participates in merging, which makes the prefix form
 * a dead end for anyone downstream trying to override it. Write the suffix form.
 *
 * No running count is kept here on purpose. The previous wording pinned a number
 * ("~36") that was already stale when read, because the census lives in files
 * this one does not own. Count it when you need it rather than trusting a
 * comment. `src/components/ui/**` and `src/theme.css` carry ZERO of either
 * dialect — verified by grep, the only two hits under that path being the two
 * examples written above.
 *
 * That zero is the point of this file: every escape that used to be needed here
 * was there to force an override past `clsx(className, defaults)`, and the
 * override now lands on its own.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * `responsiveDefault` — a two-breakpoint default that a BARE caller class can
 * still beat, at every width.
 *
 * The Catalyst type scale is written `text-base/6 sm:text-sm/6`. Both halves are
 * needed (16px on phones, 14px on desktop) and both are a trap, because whichever
 * half hides behind a variant is unreachable: `tailwind-merge` will not cross a
 * variant boundary, and neither will the cascade.
 *
 * MEASURED, on /admin/factory, `<Text className="font-mono text-xs">`:
 *   `text-base/6 sm:text-sm/6`      → 14px @1440 (override dead), 12px @375
 *   `text-sm/6 max-sm:text-base/6`  → 12px @1440 (override lands), 16px @375
 *                                     (override dead — the trap simply moved)
 * Inverting the pair only chooses WHICH viewport gets lied to.
 *
 * So the bump is emitted CONDITIONALLY: keep it while the primitive still owns
 * the size, drop it the moment the caller declares one. The test reuses
 * `tailwind-merge` itself rather than a hand-rolled `text-*` regex — compose the
 * bare rung with the caller's classes and look at whether the rung SURVIVED.
 * It survives iff nothing in `className` belongs to the font-size group, which
 * is exactly the question, and it stays correct for arbitrary values
 * (`text-[11px]`) and for `!important` in either dialect for free.
 *
 * @param base  the bare rung — the value that must win when the caller is silent
 *              AND the one a caller class competes against
 * @param bump  the variant-scoped other half (`max-sm:…`), or undefined for a
 *              flat rung with nothing to guard
 */
export function responsiveDefault(base: string, bump: string | undefined, className: ClassValue) {
  if (!bump) return base
  return cn(base, className).split(' ').includes(base) ? `${base} ${bump}` : base
}
