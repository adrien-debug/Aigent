import clsx from 'clsx'
import React, { forwardRef } from 'react'
import { Link } from './link'

export function Navbar({ className, ...props }: React.ComponentPropsWithoutRef<'nav'>) {
  return <nav {...props} className={clsx(className, 'flex flex-1 items-center gap-4 py-2.5')} />
}

export function NavbarDivider({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div aria-hidden="true" {...props} className={clsx(className, 'h-6 w-px bg-zinc-950/10 dark:bg-white/10')} />
}

export function NavbarSection({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={clsx(className, 'flex items-center gap-3')} />
}

export function NavbarSpacer({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div aria-hidden="true" {...props} className={clsx(className, 'flex-1')} />
}

export const NavbarItem = forwardRef(function NavbarItem(
  {
    current,
    className,
    children,
    ...props
  }: { current?: boolean; className?: string; children: React.ReactNode } & (
    | ({ href?: never } & React.ComponentPropsWithoutRef<'button'>)
    | ({ href: string } & React.ComponentPropsWithoutRef<typeof Link>)
  ),
  ref: React.ForwardedRef<HTMLAnchorElement | HTMLButtonElement>
) {
  const classes = clsx(
    'relative flex min-w-0 items-center gap-3 rounded-lg p-2 text-left text-sm font-medium text-zinc-950',
    'hover:bg-zinc-950/5 data-current:bg-zinc-950/5',
    'dark:text-white dark:hover:bg-white/5 dark:data-current:bg-white/5'
  )

  return typeof props.href === 'string' ? (
    <Link {...props} className={clsx(className, classes)} data-current={current ? 'true' : undefined} ref={ref as React.ForwardedRef<HTMLAnchorElement>}>
      {children}
    </Link>
  ) : (
    <button
      {...(props as React.ComponentPropsWithoutRef<'button'>)}
      className={clsx(className, classes)}
      data-current={current ? 'true' : undefined}
      ref={ref as React.ForwardedRef<HTMLButtonElement>}
    >
      {children}
    </button>
  )
})

export function NavbarLabel({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) {
  return <span {...props} className={clsx(className, 'truncate')} />
}
