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
  fixed = false,
  grid = false,
  striped = false,
  className,
  children,
  ...props
}: { bleed?: boolean; dense?: boolean; fixed?: boolean; grid?: boolean; striped?: boolean } & React.ComponentPropsWithoutRef<'div'>) {
  return (
    <TableContext.Provider value={{ bleed, dense, grid, striped } as React.ContextType<typeof TableContext>}>
      <div className="flow-root">
        {/* `fixed` tables are `w-full table-fixed`: they can never exceed the container,
            so the horizontal scrollport is pointless — and harmful. `overflow-x: auto`
            computes `overflow-y` to `auto` too, creating a nested vertical scrollport
            that (a) duplicates the caller's own scroll container and (b) traps
            `position: sticky` headers, which then never stick. Drop it when fixed. */}
        <div {...props} className={clsx(className, '-mx-(--gutter) whitespace-nowrap', !fixed && 'overflow-x-auto')}>
          <div className={clsx('inline-block min-w-full align-middle', !bleed && 'sm:px-(--gutter)')}>
            <table
              className={clsx(
                'min-w-full text-left text-sm/6 text-white',
                fixed && 'w-full table-fixed'
              )}
            >
              {children}
            </table>
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
        '[&_th]:border-b [&_th]:border-white/5'
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
          // Paint <td>, not <tr>: row background on <tr> often clips to content
          // (flush/"à ras") instead of filling the full cell box including padding.
          // Interaction feedback ONLY when the row is navigable (has an href):
          // a read-only row — and every <thead> row — must not light up on hover,
          // and painting the <td> unconditionally would also cover any
          // hover:bg-* set on the <tr> itself.
          '[&>td]:transition-colors [&>th]:transition-colors',
          href &&
            'hover:[&>td]:bg-[var(--color-surface-interactive)] hover:[&>th]:bg-[var(--color-surface-interactive)] has-[[data-row-link][data-focus]]:outline-2 has-[[data-row-link][data-focus]]:-outline-offset-2 has-[[data-row-link][data-focus]]:outline-accent-500 dark:focus-within:[&>td]:bg-white/2',
          striped && 'even:[&>td]:bg-zinc-950/2 dark:even:[&>td]:bg-white/2'
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
          'px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-500 first:pl-(--gutter,--spacing(2)) last:pr-(--gutter,--spacing(2))',
          grid && 'border-l border-l-zinc-950/5 first:border-l-0 dark:border-l-white/5',
          !bleed && 'sm:first:pl-1 sm:last:pr-1'
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
        'relative px-4 first:pl-(--gutter,--spacing(2)) last:pr-(--gutter,--spacing(2))',
        !striped && 'border-b border-white/5',
        grid && 'border-l border-l-white/5 first:border-l-0',
        dense ? 'py-3' : 'py-4',
        !bleed && 'sm:first:pl-1 sm:last:pr-1'
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
