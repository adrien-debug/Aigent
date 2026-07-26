import * as Headless from '@headlessui/react'
import React, { forwardRef } from 'react'
import { TouchTarget } from './button'
import { cn, responsiveDefault } from './cn'
import { Link } from './link'

const colors = {
  zinc: 'bg-zinc-950/5 text-zinc-600 ring-1 ring-inset ring-zinc-950/10 group-data-hover:bg-zinc-950/10 dark:bg-white/[0.03] dark:text-zinc-400 dark:ring-white/10 dark:group-data-hover:bg-white/10',
  // Accent monochrome ladder — the design system's only chromatic badges.
  // Intensity (soft → strong → solid) encodes escalation; the label carries meaning.
  accent:
    'bg-(--accent-surface) text-accent-700 ring-1 ring-inset ring-(--accent-line) group-data-hover:bg-accent-500/25 dark:text-accent-300 dark:group-data-hover:bg-accent-500/25',
  accentStrong:
    'bg-accent-500/25 text-accent-800 ring-1 ring-inset ring-(--accent-line-strong) group-data-hover:bg-accent-500/35 dark:text-accent-200 dark:group-data-hover:bg-accent-500/35',
  accentSolid:
    'bg-accent-600 text-zinc-950 shadow-sm group-data-hover:bg-accent-700 dark:bg-accent-600 dark:text-zinc-950 dark:group-data-hover:bg-accent-700',
  // Danger — the ONE non-accent hue, on the `--state-danger-*` roles already
  // declared in theme.css as "the only deliberate exception" to the mono-accent
  // rule. It exists because the accent ladder above encodes ESCALATION, not
  // OUTCOME: applied to a failure it says "most intense" in the colour that
  // everywhere else means success, so `failed` and `completed` differ only by
  // their label. A state whose colour IS its meaning gets this key.
  danger:
    'bg-(--state-danger-soft) text-(--state-danger-text) ring-1 ring-inset ring-(--state-danger-line) group-data-hover:bg-(--state-danger-line)',
  dangerSolid:
    'bg-(--state-danger-solid) text-white shadow-sm ring-1 ring-inset ring-(--state-danger-solid-line) group-data-hover:bg-(--state-danger-base)',
}

/**
 * Geometry ladder — a PROP, for the same reason `Text` has one.
 *
 * Catalyst wrote the type scale `text-sm/5 sm:text-xs/5`: the desktop value sat
 * behind a `sm:` variant, unreachable by any bare caller class, so
 * `<Badge className="text-[10px]">` rendered 12px on every desktop viewport.
 * `md` keeps the SAME two sizes at the SAME two widths, split into the bare rung
 * a caller competes against and the complementary `max-sm:` half that
 * `responsiveDefault` (./cn) withdraws once the caller declares a size.
 *
 * `xs` is the micro-label the leaderboard and the dense tables were reaching for
 * with `px-0 text-[10px]`. Radius is NOT part of a size: a pill stays a
 * `rounded-full` on the caller side, and `cn` now lets that override land.
 */
const BADGE_SIZES = {
  /** Catalyst default — 14px on phones, 12px from 640px up. */
  md: { pad: 'px-1.5 py-0.5', base: 'text-xs/5', bump: 'max-sm:text-sm/5' },
  /** 10px flat, no horizontal padding: an inline marker inside a dense row. */
  xs: { pad: 'px-0 py-0', base: 'text-[10px]/4' },
} as const satisfies Record<string, { pad: string; base: string; bump?: string }>

type BadgeProps = { color?: keyof typeof colors; size?: keyof typeof BADGE_SIZES }

export function Badge({
  color = 'zinc',
  size = 'md',
  className,
  ...props
}: BadgeProps & React.ComponentPropsWithoutRef<'span'>) {
  const { pad, base, bump } = { bump: undefined, ...BADGE_SIZES[size] }
  return (
    <span
      {...props}
      // Defaults FIRST, caller LAST. `colors[color]` sits before `className` too,
      // so a caller CAN now repaint a badge — which is exactly why `check:danger`
      // and `check:ds` remain the gates that police which colours are legal.
      className={cn(
        'inline-flex items-center gap-x-1.5 rounded-md font-medium forced-colors:outline',
        pad,
        responsiveDefault(base, bump, className),
        colors[color],
        className
      )}
    />
  )
}

export const BadgeButton = forwardRef(function BadgeButton(
  {
    color = 'zinc',
    className,
    children,
    ...props
  }: BadgeProps & { className?: string; children: React.ReactNode } & (
      | ({ href?: never } & Omit<Headless.ButtonProps, 'as' | 'className'>)
      | ({ href: string } & Omit<React.ComponentPropsWithoutRef<typeof Link>, 'className'>)
    ),
  ref: React.ForwardedRef<HTMLElement>
) {
  let classes = cn(
    'group relative inline-flex rounded-md focus:not-data-focus:outline-hidden data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-accent-500',
    className
  )

  return typeof props.href === 'string' ? (
    <Link {...props} className={classes} ref={ref as React.ForwardedRef<HTMLAnchorElement>}>
      <TouchTarget>
        <Badge color={color}>{children}</Badge>
      </TouchTarget>
    </Link>
  ) : (
    <Headless.Button {...props} className={classes} ref={ref}>
      <TouchTarget>
        <Badge color={color}>{children}</Badge>
      </TouchTarget>
    </Headless.Button>
  )
})
