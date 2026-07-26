import clsx from 'clsx'

import { cn } from '@/components/ui/cn'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

/**
 * Micro-eyebrow — the tiny uppercase overline shared by `PageHeader` and
 * the `AgentKpiBand` stat labels. ONE definition so the overline never drifts in
 * size/weight/tracking/colour between the page header and the KPI strip, and so a
 * layout flag (density/separators) can never change its TYPOGRAPHY — only its
 * surrounding geometry (min-height, margin).
 *
 * The colour is `zinc-400` and the comment above it used to say so while the
 * constant shipped `zinc-500` — a doc that described an intention nobody had
 * encoded. Measured on the five planes this overline actually lands on (WCAG
 * 2.x contrast, 10px ⇒ the 4.5 threshold, not the 3.0 large-text one):
 *
 *   plane      canvas    #111114  #1a1a1e  #0d0d10  #232327
 *   zinc-500   4.12      3.90     3.59     4.02     3.24    ← fails all five
 *   zinc-400   7.76      7.35     6.77     7.57     6.11    ← passes all five
 *
 * Because this is the ONE definition, every eyebrow rendered through it moves
 * together. Overlines written by hand elsewhere do NOT — they have to import
 * this constant to inherit the fix.
 */
export const eyebrowClass = 'text-[10px] font-medium uppercase tracking-widest text-zinc-400'

/**
 * Canvas-level page header — title + optional description on the black canvas.
 * No enclosing card; separates from content with a hairline only.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  // `pb-4` is a DEFAULT, not a floor: `<PageHeader className="pb-0" />` used to
  // render 16px anyway because Tailwind resolves `pb-0` vs `pb-4` by compiled
  // sheet order, not by the class attribute. `cn` (tailwind-merge) drops the
  // default in JS when the caller states the family, so the override is real.
  // This replaced `class-defaults.ts`, a hand-rolled version of the same idea
  // written before the repo had a merge library — see page-layout.tsx.
  return (
    <header className={cn('pb-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? <p className={eyebrowClass}>{eyebrow}</p> : null}
          {/* Canon DS: Catalyst Heading = text-2xl/8 (24px). Never text-3xl.
              No colour here: `Heading` already ships `text-zinc-950 dark:text-white`
              and composes `clsx(className, defaults)`, so the `text-zinc-900
              dark:text-white` that used to sit on this line was a pair of dead
              classes — one overridden by the default, one identical to it. */}
          <Heading className={clsx(eyebrow ? 'mt-1' : undefined, 'tracking-tight')}>{title}</Heading>
          {description ? (
            // Same story: `Text` ships `text-zinc-500 dark:text-zinc-400`, which
            // is exactly what the removed override asked for in dark (the only
            // mode /admin ever paints) and what it could never win in light.
            <Text className="mt-1.5 max-w-3xl tracking-tight">{description}</Text>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
      </div>
    </header>
  )
}
