import { cn, responsiveDefault } from './cn'

/**
 * Catalyst `Badge`, re-introduced from the official kit
 * (`~/.claude/tailwind-blocks/catalyst/typescript/badge.tsx`) with three
 * deliberate departures — each one is a rule of this repo, not taste:
 *
 *  1. MONO-ACCENT. The kit ships eighteen colour keys, one per Tailwind hue.
 *     This design system has exactly ONE accent — the brand green `#A7FB90` —
 *     plus ONE non-accent role, danger, reserved for failure and destruction.
 *     The other sixteen keys were DELETED, not left unused: a hue that is
 *     merely available is a hue that eventually ships.
 *  2. `cn` with the caller's `className` LAST. The kit writes
 *     `clsx(className, defaults)`, which reads like "the caller wins" and is
 *     false — see `./cn` for the measured story.
 *  3. `BadgeButton` dropped. It has no consumer here, and it hard-coded a focus
 *     ring on a second hue.
 *
 * Dark is the only branch that ever renders (`.dark` is hard-set on `<html>`,
 * there is no toggle), but the light half is kept so the file stays diffable
 * against the upstream kit.
 */
const colors = {
  /**
   * Neutral, and the DEFAULT. A badge that carries no judgement — a version, a
   * runtime, a count — is zinc. Reaching for a colour is a claim.
   */
  zinc: 'bg-zinc-600/10 text-zinc-700 dark:bg-white/5 dark:text-zinc-400',
  /**
   * The single brand hue, on the accent surface/line roles of `theme.css`.
   * `accent-300` (#cefac1) on `--accent-surface` over the card graphite
   * measures ~11:1 — the ramp's light steps are the only readable text on a
   * dark tint of this green.
   */
  accent:
    'bg-[color-mix(in_oklab,var(--color-accent-600)_18%,transparent)] text-accent-700 ring-1 ring-(color:--accent-line) dark:bg-(--accent-surface) dark:text-accent-300',
  /**
   * The ONE non-accent hue. Failure and destruction only — never "warning",
   * never decoration. `--state-danger-text` (#f87171) on this tint over the
   * card graphite measures ~6:1.
   */
  danger:
    'bg-[color-mix(in_oklab,var(--state-danger-solid)_14%,transparent)] text-[var(--state-danger-solid)] ring-1 ring-(color:--state-danger-solid-line) dark:bg-[color-mix(in_oklab,var(--state-danger-solid)_18%,transparent)] dark:text-[var(--state-danger-text)]',
}

type BadgeProps = { color?: keyof typeof colors }

export function Badge({ color = 'zinc', className, ...props }: BadgeProps & React.ComponentPropsWithoutRef<'span'>) {
  return (
    <span
      {...props}
      // The size pair is emitted through `responsiveDefault`: the kit's
      // `text-sm/5 sm:text-xs/5` hides the desktop rung behind a variant, where
      // no bare caller class can reach it (`./cn`, limit 1). Same two sizes,
      // but a caller asking for `text-[11px]` now actually gets it.
      className={cn(
        'inline-flex items-center gap-x-1.5 rounded-md px-1.5 py-0.5 font-medium forced-colors:outline',
        responsiveDefault('text-xs/5', 'max-sm:text-sm/5', className),
        colors[color],
        className
      )}
    />
  )
}
