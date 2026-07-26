import { cn } from '@/components/ui/cn'

/**
 * Vertical rhythm shared by every /admin page: a flex column, a default gap and
 * a default bottom breathing room.
 *
 * `gap-4` and `pb-8` are DEFAULTS the caller may replace. They were once layered
 * as `clsx('flex flex-col gap-4 pb-8', className)`, which only appeared to work:
 * `gap-8`/`pb-12` win because Tailwind emits the larger step later in the
 * compiled sheet, while `<PageLayout className="… gap-4 pb-0">` (the team tab)
 * lost its `pb-0` to `pb-8` and carried 32px of dead space under a pane meant to
 * end flush. Same defect, opposite outcome, decided by nothing more than which
 * number sorts last.
 *
 * The fix used to be `class-defaults.ts`, a hand-rolled "don't emit a default the
 * caller already spoke for". That file has been DELETED, not disabled: it existed
 * only because — in its own words — "this repo does not ship [a merge library]
 * and adding a dependency is not this layer's call", and that is no longer true.
 * `src/components/ui/cn.ts` wraps `tailwind-merge` and every one of the 19
 * primitives now composes through it. Two mechanisms answering the same question
 * is how the two drift apart.
 *
 * `cn` is also strictly stronger than what it replaces: it resolves shorthands
 * the same way (`p-0` beats `pb-8`) but additionally handles arbitrary values
 * (`pb-[7px]`), the `gap-x`/`gap-y` split, and both `!important` dialects — none
 * of which the family-prefix string match could see. Measured identical on all
 * seven /admin call sites before and after (padding-bottom and row-gap in
 * Chromium); it additionally collapses the duplicated `flex flex-col` the team
 * tab was emitting.
 */
export function PageLayout({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn('flex flex-col gap-4 pb-8', className)}>{children}</div>
}
