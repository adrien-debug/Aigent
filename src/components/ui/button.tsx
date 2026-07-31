import clsx from 'clsx'
import React, { forwardRef } from 'react'
import { Link } from './link'

const base =
  'relative inline-flex items-baseline justify-center gap-x-2 rounded-lg border px-3 py-1.5 text-sm font-semibold ' +
  'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ' +
  'disabled:opacity-50 disabled:pointer-events-none'

const variants = {
  solid: 'border-transparent bg-zinc-900 text-white shadow-sm hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white',
  outline: 'border-zinc-950/10 text-zinc-950 hover:bg-zinc-950/5 dark:border-white/15 dark:text-white dark:hover:bg-white/5',
  plain: 'border-transparent text-zinc-950 hover:bg-zinc-950/5 dark:text-white dark:hover:bg-white/10',
  red: 'border-transparent bg-red-600 text-white shadow-sm hover:bg-red-500',
}

type ButtonProps = { color?: 'red' | 'zinc' | 'dark/zinc'; outline?: boolean; plain?: boolean } & {
  className?: string
  children: React.ReactNode
} & (({ href?: never } & React.ComponentPropsWithoutRef<'button'>) | ({ href: string } & React.ComponentPropsWithoutRef<typeof Link>))

export const Button = forwardRef(function Button(
  { color, outline, plain, className, children, ...props }: ButtonProps,
  ref: React.ForwardedRef<HTMLElement>
) {
  const variant = color === 'red' ? variants.red : outline ? variants.outline : plain ? variants.plain : variants.solid
  const classes = clsx(className, base, variant)

  return typeof props.href === 'string' ? (
    <Link {...props} className={classes} ref={ref as React.ForwardedRef<HTMLAnchorElement>}>
      {children}
    </Link>
  ) : (
    <button {...(props as React.ComponentPropsWithoutRef<'button'>)} className={classes} ref={ref as React.ForwardedRef<HTMLButtonElement>}>
      {children}
    </button>
  )
})

export function TouchTarget({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
