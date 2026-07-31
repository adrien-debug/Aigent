'use client'

import clsx from 'clsx'
import type React from 'react'
import { createContext, useContext } from 'react'
import { Link } from './link'

const TableContext = createContext<{ dense: boolean; striped: boolean }>({ dense: false, striped: false })

export function Table({
  dense = false,
  striped = false,
  className,
  children,
  ...props
}: { dense?: boolean; striped?: boolean } & React.ComponentPropsWithoutRef<'div'>) {
  return (
    <TableContext.Provider value={{ dense, striped }}>
      <div {...props} className={clsx(className, 'overflow-x-auto')}>
        <table className="min-w-full text-left text-sm text-zinc-950 dark:text-white">{children}</table>
      </div>
    </TableContext.Provider>
  )
}

export function TableHead({ className, ...props }: React.ComponentPropsWithoutRef<'thead'>) {
  return <thead {...props} className={clsx(className, 'text-zinc-500 dark:text-zinc-400')} />
}

export function TableBody(props: React.ComponentPropsWithoutRef<'tbody'>) {
  return <tbody {...props} />
}

const TableRowContext = createContext<{ href?: string }>({ href: undefined })

export function TableRow({ href, className, ...props }: { href?: string } & React.ComponentPropsWithoutRef<'tr'>) {
  const { striped } = useContext(TableContext)

  return (
    <TableRowContext.Provider value={{ href }}>
      <tr
        {...props}
        className={clsx(className, striped && 'even:bg-zinc-950/2.5 dark:even:bg-white/2.5', href && 'hover:bg-zinc-950/5 dark:hover:bg-white/5')}
      />
    </TableRowContext.Provider>
  )
}

export function TableHeader({ className, ...props }: React.ComponentPropsWithoutRef<'th'>) {
  return <th {...props} className={clsx(className, 'border-b border-zinc-950/10 px-4 py-2 font-medium dark:border-white/10')} />
}

export function TableCell({ className, children, ...props }: React.ComponentPropsWithoutRef<'td'>) {
  const { dense } = useContext(TableContext)
  const { href } = useContext(TableRowContext)

  return (
    <td {...props} className={clsx(className, 'relative border-b border-zinc-950/5 px-4 dark:border-white/5', dense ? 'py-2.5' : 'py-4')}>
      {href && <Link href={href} className="absolute inset-0" />}
      {children}
    </td>
  )
}
