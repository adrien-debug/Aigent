import clsx from 'clsx'
import React, { forwardRef } from 'react'
import { Link } from './link'

export function Sidebar({ className, ...props }: React.ComponentPropsWithoutRef<'nav'>) {
  return <nav {...props} className={clsx(className, 'flex h-full min-h-0 flex-col')} />
}

export function SidebarHeader({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={clsx(className, 'flex flex-col border-b border-zinc-950/5 p-4 dark:border-white/5')} />
}

export function SidebarBody({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={clsx(className, 'flex flex-1 flex-col gap-8 overflow-y-auto p-4')} />
}

export function SidebarFooter({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={clsx(className, 'flex flex-col border-t border-zinc-950/5 p-4 dark:border-white/5')} />
}

export function SidebarSection({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div {...props} data-slot="section" className={clsx(className, 'flex flex-col gap-0.5')} />
}

export function SidebarDivider({ className, ...props }: React.ComponentPropsWithoutRef<'hr'>) {
  return <hr {...props} className={clsx(className, 'my-4 border-t border-zinc-950/5 dark:border-white/5')} />
}

export function SidebarSpacer({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div aria-hidden="true" {...props} className={clsx(className, 'flex-1')} />
}

export function SidebarHeading({ className, ...props }: React.ComponentPropsWithoutRef<'h3'>) {
  return <h3 {...props} className={clsx(className, 'mb-1 px-2 text-xs font-medium text-zinc-500 dark:text-zinc-400')} />
}

export const SidebarItem = forwardRef(function SidebarItem(
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
    'flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm font-medium text-zinc-950',
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

export function SidebarLabel({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) {
  return <span {...props} className={clsx(className, 'truncate')} />
}
