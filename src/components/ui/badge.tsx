import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import React, { forwardRef } from 'react'
import { TouchTarget } from './button'
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

type BadgeProps = { color?: keyof typeof colors }

export function Badge({ color = 'zinc', className, ...props }: BadgeProps & React.ComponentPropsWithoutRef<'span'>) {
  return (
    <span
      {...props}
      className={clsx(
        className,
        'inline-flex items-center gap-x-1.5 rounded-md px-1.5 py-0.5 text-sm/5 font-medium sm:text-xs/5 forced-colors:outline',
        colors[color]
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
  let classes = clsx(
    className,
    'group relative inline-flex rounded-md focus:not-data-focus:outline-hidden data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-accent-500'
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
