'use client'

import clsx from 'clsx'
import type React from 'react'
import { createContext, useContext, useState } from 'react'
import { Link } from './link'

const TableContext = createContext<{ bleed: boolean; dense: boolean; grid: boolean; striped: boolean }>({
  bleed: false,
  dense: false,
  grid: false,
  striped: false,
})

export function Table({
  bleed = false,
  dense = false,
  grid = false,
  striped = false,
  /**
   * Table bornée par la grille du cockpit : l'en-tête reste fixe et seul le
   * corps défile, dans la hauteur imposée par le panneau. Sans cette option la
   * table Catalyst grandit avec la donnée — ce qui casserait le zéro-scroll.
   */
  bounded = false,
  className,
  children,
  ...props
}: {
  bleed?: boolean
  dense?: boolean
  grid?: boolean
  striped?: boolean
  bounded?: boolean
} & React.ComponentPropsWithoutRef<'div'>) {
  return (
    <TableContext.Provider value={{ bleed, dense, grid, striped } as React.ContextType<typeof TableContext>}>
      <div className={clsx(bounded ? 'flex h-full min-h-0 flex-col' : 'flow-root')}>
        <div
          {...props}
          className={clsx(
            className,
            bounded ? 'scroll-thin min-h-0 flex-1 overflow-y-auto' : '-mx-(--gutter) overflow-x-auto whitespace-nowrap'
          )}
        >
          <div className={clsx('inline-block min-w-full align-middle', !bleed && !bounded && 'sm:px-(--gutter)')}>
            <table className="min-w-full text-left text-[11px]/5 text-ink">{children}</table>
          </div>
        </div>
      </div>
    </TableContext.Provider>
  )
}

export function TableHead({ className, ...props }: React.ComponentPropsWithoutRef<'thead'>) {
  return (
    <thead
      {...props}
      className={clsx(
        className,
        'sticky top-0 z-10 bg-raised text-[9px] font-semibold tracking-[0.16em] text-ink-faint uppercase'
      )}
    />
  )
}

export function TableBody(props: React.ComponentPropsWithoutRef<'tbody'>) {
  return <tbody {...props} />
}

const TableRowContext = createContext<{ href?: string; target?: string; title?: string }>({
  href: undefined,
  target: undefined,
  title: undefined,
})

export function TableRow({
  href,
  target,
  title,
  className,
  ...props
}: { href?: string; target?: string; title?: string } & React.ComponentPropsWithoutRef<'tr'>) {
  let { striped } = useContext(TableContext)

  return (
    <TableRowContext.Provider value={{ href, target, title } as React.ContextType<typeof TableRowContext>}>
      <tr
        {...props}
        className={clsx(
          className,
          'group transition-colors hover:bg-elevated',
          href &&
            'has-[[data-row-link][data-focus]]:outline-2 has-[[data-row-link][data-focus]]:-outline-offset-2 has-[[data-row-link][data-focus]]:outline-accent focus-within:bg-elevated',
          striped && 'even:bg-white/2'
        )}
      />
    </TableRowContext.Provider>
  )
}

export function TableHeader({ className, ...props }: React.ComponentPropsWithoutRef<'th'>) {
  let { bleed, grid } = useContext(TableContext)

  return (
    <th
      {...props}
      className={clsx(
        className,
        'border-b border-b-white/6 px-3 py-1.5 font-semibold first:pl-3.5 last:pr-3.5',
        grid && 'border-l border-l-white/5 first:border-l-0',
        !bleed && 'sm:first:pl-3.5 sm:last:pr-3.5'
      )}
    />
  )
}

export function TableCell({ className, children, ...props }: React.ComponentPropsWithoutRef<'td'>) {
  let { bleed, dense, grid, striped } = useContext(TableContext)
  let { href, target, title } = useContext(TableRowContext)
  let [cellRef, setCellRef] = useState<HTMLElement | null>(null)

  return (
    <td
      ref={href ? setCellRef : undefined}
      {...props}
      className={clsx(
        className,
        'relative px-3 first:pl-3.5 last:pr-3.5',
        !striped && 'border-b border-white/[0.035]',
        grid && 'border-l border-l-white/5 first:border-l-0',
        dense ? 'py-2' : 'py-3',
        !bleed && 'sm:first:pl-3.5 sm:last:pr-3.5'
      )}
    >
      {href && (
        <Link
          data-row-link
          href={href}
          target={target}
          aria-label={title}
          tabIndex={cellRef?.previousElementSibling === null ? 0 : -1}
          className="absolute inset-0 focus:outline-hidden"
        />
      )}
      {children}
    </td>
  )
}
