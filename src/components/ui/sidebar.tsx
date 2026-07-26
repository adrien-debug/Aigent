'use client'

import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import { LayoutGroup, motion } from 'motion/react'
import React, { forwardRef, useId } from 'react'
import { TouchTarget } from './button'
import { cn } from './cn'
import { Link } from './link'

export function Sidebar({ className, ...props }: React.ComponentPropsWithoutRef<'nav'>) {
  return <nav {...props} className={cn('flex h-full min-h-0 flex-col', className)} />
}

export function SidebarHeader({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className={cn(
        'flex flex-col border-b border-zinc-950/5 p-4 dark:border-white/5 [&>[data-slot=section]+[data-slot=section]]:mt-2.5',
        className
      )}
    />
  )
}

export function SidebarBody({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className={cn(
        'flex flex-1 flex-col overflow-y-auto p-4 [&>[data-slot=section]+[data-slot=section]]:mt-8',
        className
      )}
    />
  )
}

export function SidebarFooter({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className={cn(
        'flex flex-col border-t border-zinc-950/5 p-4 dark:border-white/5 [&>[data-slot=section]+[data-slot=section]]:mt-2.5',
        className
      )}
    />
  )
}

export function SidebarSection({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  let id = useId()

  return (
    <LayoutGroup id={id}>
      <div {...props} data-slot="section" className={cn('flex flex-col gap-0.5', className)} />
    </LayoutGroup>
  )
}

export function SidebarDivider({ className, ...props }: React.ComponentPropsWithoutRef<'hr'>) {
  return <hr {...props} className={cn('my-4 border-t border-zinc-950/5 lg:-mx-4 dark:border-white/5', className)} />
}

export function SidebarSpacer({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div aria-hidden="true" {...props} className={cn('mt-8 flex-1', className)} />
}

export function SidebarHeading({ className, ...props }: React.ComponentPropsWithoutRef<'h3'>) {
  return (
    <h3 {...props} className={cn('mb-1 px-2 text-xs/6 font-medium text-zinc-500 dark:text-zinc-400', className)} />
  )
}

export const SidebarItem = forwardRef(function SidebarItem(
  {
    current,
    className,
    children,
    ...props
  }: { current?: boolean; className?: string; children: React.ReactNode } & (
    | ({ href?: never } & Omit<Headless.ButtonProps, 'as' | 'className'>)
    | ({ href: string } & Omit<Headless.ButtonProps<typeof Link>, 'as' | 'className'>)
  ),
  ref: React.ForwardedRef<HTMLAnchorElement | HTMLButtonElement>
) {
  let classes = clsx(
    // Base
    'flex w-full min-h-11 items-center gap-3 rounded-lg px-2 py-2.5 text-left text-base/6 font-medium text-zinc-950 sm:min-h-0 sm:py-2 sm:text-sm/5',
    // Leading icon/icon-only
    '*:data-[slot=icon]:size-6 *:data-[slot=icon]:shrink-0 *:data-[slot=icon]:fill-zinc-500 sm:*:data-[slot=icon]:size-5',
    // Trailing icon (down chevron or similar)
    '*:last:data-[slot=icon]:ml-auto *:last:data-[slot=icon]:size-5 sm:*:last:data-[slot=icon]:size-4',
    // Avatar
    '*:data-[slot=avatar]:-m-0.5 *:data-[slot=avatar]:size-7 sm:*:data-[slot=avatar]:size-6',
    // Focus — the SAME treatment `Button`, `Badge` and `Avatar` already ship.
    //
    // The kit left SidebarItem with no focus rule at all, so Chromium fell back
    // to its own ring. Measured by tabbing the real /admin rail: every one of the
    // nine stops (Search + 7 routes + the account row) painted
    // `outline: auto 1px rgb(0, 95, 204)` — the UA blue. Three things wrong with
    // that, in order of severity: it is a THIRD hue in a design system whose one
    // rule is accent-green + zinc (AGENTS.md); it contradicts every other
    // focusable primitive, so the keyboard ring changes colour as you tab out of
    // the rail; and #005FCC on the near-black rail (#09090b) computes 3.29:1,
    // barely over the 3.0 non-text floor, where accent-500 computes 15.99:1.
    'focus:not-data-focus:outline-hidden data-focus:outline-2 data-focus:-outline-offset-2 data-focus:outline-accent-500',
    // Hover
    'data-hover:bg-zinc-950/5 data-hover:*:data-[slot=icon]:fill-zinc-950',
    // Active
    'data-active:bg-zinc-950/5 data-active:*:data-[slot=icon]:fill-zinc-950',
    // Current
    // Current: the brand accent tints the icon and the rail marker. The label
    // stays zinc — one accent cue per active item, never a fully green row.
    'data-current:bg-zinc-950/5 data-current:font-semibold data-current:*:data-[slot=icon]:fill-accent-600',
    // Current + hover — a DISTINCT step, not a repeat of the resting fill.
    // `data-current:bg-white/5` and `data-hover:bg-white/5` were the same value,
    // so hovering the open route changed nothing: measured on /admin, the
    // Dashboard row read `oklab(… / 0.05)` at rest AND under the pointer, while
    // every other row went transparent → 0.05. The one row you are most likely
    // to point at was the only one that did not answer.
    'data-current:data-hover:bg-zinc-950/10 data-current:data-active:bg-zinc-950/10',
    // Dark mode
    'dark:text-white dark:*:data-[slot=icon]:fill-zinc-400',
    'dark:data-hover:bg-white/5 dark:data-hover:*:data-[slot=icon]:fill-white',
    'dark:data-active:bg-white/5 dark:data-active:*:data-[slot=icon]:fill-white',
    'dark:data-current:bg-white/5 dark:data-current:*:data-[slot=icon]:fill-accent-400',
    'dark:data-current:data-hover:bg-white/10 dark:data-current:data-active:bg-white/10'
  )

  return (
    <span className={cn('relative', className)}>
      {current && (
        <motion.span
          layoutId="current-indicator"
          className="absolute inset-y-2 -left-4 w-0.5 rounded-full bg-accent-600 dark:bg-accent-500"
        />
      )}
      {typeof props.href === 'string' ? (
        <Headless.CloseButton
          as={Link}
          {...props}
          className={classes}
          data-current={current ? 'true' : undefined}
          // `data-current` only drives CSS — it says nothing to the a11y tree.
          // Without `aria-current` a screen reader reads every nav entry the
          // same way and the user has no way to tell which route is open.
          aria-current={current ? 'page' : undefined}
          ref={ref}
        >
          <TouchTarget>{children}</TouchTarget>
        </Headless.CloseButton>
      ) : (
        <Headless.Button
          {...props}
          className={clsx('cursor-pointer', classes)}
          data-current={current ? 'true' : undefined}
          // Same exposure on the button variant: `current` must mean the same
          // thing to assistive tech whether the item navigates or dispatches.
          aria-current={current ? 'page' : undefined}
          ref={ref}
        >
          <TouchTarget>{children}</TouchTarget>
        </Headless.Button>
      )}
    </span>
  )
})

export function SidebarLabel({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) {
  return <span {...props} className={cn('truncate', className)} />
}
