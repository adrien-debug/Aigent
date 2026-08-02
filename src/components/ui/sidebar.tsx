'use client'

// Couleurs issues des jetons `--aig-*`. Les variantes `dark:` ont disparu :
// les jetons sont deja sombres, une seule valeur suffit par surface.

import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import { LayoutGroup, motion } from 'motion/react'
import React, { forwardRef, useId } from 'react'
import { TouchTarget } from './button'
import { Link } from './link'

export function Sidebar({ className, ...props }: Readonly<React.ComponentPropsWithoutRef<'nav'>>) {
  return <nav {...props} className={clsx(className, 'flex h-full min-h-0 flex-col')} />
}

export function SidebarHeader({ className, ...props }: Readonly<React.ComponentPropsWithoutRef<'div'>>) {
  return (
    <div
      {...props}
      className={clsx(
        className,
        'flex flex-col border-b border-(--aig-line) p-4 [&>[data-slot=section]+[data-slot=section]]:mt-2.5'
      )}
    />
  )
}

export function SidebarBody({ className, ...props }: Readonly<React.ComponentPropsWithoutRef<'div'>>) {
  return (
    <div
      {...props}
      className={clsx(
        className,
        'flex flex-1 flex-col overflow-y-auto p-4 [&>[data-slot=section]+[data-slot=section]]:mt-8'
      )}
    />
  )
}

export function SidebarFooter({ className, ...props }: Readonly<React.ComponentPropsWithoutRef<'div'>>) {
  return (
    <div
      {...props}
      className={clsx(
        className,
        'flex flex-col border-t border-(--aig-line) p-4 [&>[data-slot=section]+[data-slot=section]]:mt-2.5'
      )}
    />
  )
}

export function SidebarSection({ className, ...props }: Readonly<React.ComponentPropsWithoutRef<'div'>>) {
  const id = useId()

  return (
    <LayoutGroup id={id}>
      <div {...props} data-slot="section" className={clsx(className, 'flex flex-col gap-0.5')} />
    </LayoutGroup>
  )
}

export function SidebarDivider({ className, ...props }: Readonly<React.ComponentPropsWithoutRef<'hr'>>) {
  return <hr {...props} className={clsx(className, 'my-4 border-t border-(--aig-line) lg:-mx-4')} />
}

export function SidebarSpacer({ className, ...props }: Readonly<React.ComponentPropsWithoutRef<'div'>>) {
  return <div aria-hidden="true" {...props} className={clsx(className, 'mt-8 flex-1')} />
}

export function SidebarHeading({ className, ...props }: Readonly<React.ComponentPropsWithoutRef<'h3'>>) {
  return (
    <h3 {...props} className={clsx(className, 'mb-1 px-2 text-xs/6 font-medium text-(--aig-text-muted)')} />
  )
}

export const SidebarItem = forwardRef(function SidebarItem(
  {
    current,
    className,
    children,
    ...props
  }: Readonly<
    { current?: boolean; className?: string; children: React.ReactNode } & (
      | ({ href?: never } & Omit<Headless.ButtonProps, 'as' | 'className'>)
      | ({ href: string } & Omit<Headless.ButtonProps<typeof Link>, 'as' | 'className'>)
    )
  >,
  ref: React.ForwardedRef<HTMLAnchorElement | HTMLButtonElement>
) {
  const classes = clsx(
    // Base
    'flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left text-base/6 font-medium text-(--aig-text) sm:py-2 sm:text-sm/5',
    // Leading icon/icon-only
    '*:data-[slot=icon]:size-6 *:data-[slot=icon]:shrink-0 *:data-[slot=icon]:fill-(--aig-text-muted) sm:*:data-[slot=icon]:size-5',
    // Trailing icon (down chevron or similar)
    '*:last:data-[slot=icon]:ml-auto *:last:data-[slot=icon]:size-5 sm:*:last:data-[slot=icon]:size-4',
    // Avatar
    '*:data-[slot=avatar]:-m-0.5 *:data-[slot=avatar]:size-7 sm:*:data-[slot=avatar]:size-6',
    // Hover
    'data-hover:bg-(--aig-line-soft) data-hover:*:data-[slot=icon]:fill-(--aig-text)',
    // Active
    'data-active:bg-(--aig-line-soft) data-active:*:data-[slot=icon]:fill-(--aig-text)',
    // Current
    'data-current:*:data-[slot=icon]:fill-(--aig-text)'
  )

  return (
    <span className={clsx(className, 'relative')}>
      {current && (
        <motion.span
          layoutId="current-indicator"
          className="absolute inset-y-2 -left-4 w-0.5 rounded-full bg-(--aig-accent)"
        />
      )}
      {typeof props.href === 'string' ? (
        <Headless.CloseButton
          as={Link}
          {...props}
          className={classes}
          data-current={current ? 'true' : undefined}
          ref={ref}
        >
          <TouchTarget>{children}</TouchTarget>
        </Headless.CloseButton>
      ) : (
        <Headless.Button
          {...props}
          className={clsx('cursor-default', classes)}
          data-current={current ? 'true' : undefined}
          ref={ref}
        >
          <TouchTarget>{children}</TouchTarget>
        </Headless.Button>
      )}
    </span>
  )
})

export function SidebarLabel({ className, ...props }: Readonly<React.ComponentPropsWithoutRef<'span'>>) {
  return <span {...props} className={clsx(className, 'truncate')} />
}
