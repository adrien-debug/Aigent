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
  caption,
  dense = false,
  fixed = false,
  grid = false,
  striped = false,
  className,
  children,
  ...props
}: {
  bleed?: boolean
  /* Accessible name for the table, announced by screen readers before the rows.
     Rendered `sr-only` so it costs ZERO pixels — a <caption> is the only way to
     name a <table> without an extra visible heading, and `aria-label` on a
     <table> is ignored by several screen readers. Optional and undefined by
     default: with no caption the markup is byte-identical to before. */
  caption?: string
  dense?: boolean
  fixed?: boolean
  grid?: boolean
  striped?: boolean
} & React.ComponentPropsWithoutRef<'div'>) {
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
                'min-w-full text-left text-sm/6 text-zinc-950 dark:text-white',
                fixed && 'w-full table-fixed'
              )}
            >
              {/* <caption> must be the FIRST child of <table> — the HTML parser
                  hoists it there anyway, so emitting it anywhere else desyncs
                  React's client tree from the parsed DOM and trips hydration. */}
              {caption ? <caption className="sr-only">{caption}</caption> : null}
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
      // Header sits on the SUNKEN plane, opaque: it must read as a distinct band
      // rather than another row, and an opaque fill is what lets a sticky header
      // cover the rows scrolling under it instead of blending with them.
      //
      // The fill is painted on the <th> cells, NOT on <thead>: the table is
      // wrapped in `sm:px-(--gutter)`, so a background on <thead> stops short of
      // the card's edges and the band visibly falls short on both sides. The
      // cells span the full width, so painting them takes the fill edge to edge.
      className={clsx(
        className,
        '[&_th]:bg-zinc-50 dark:[&_th]:bg-surface-sunken',
        '[&_th]:border-b [&_th]:border-zinc-950/10 dark:[&_th]:border-[var(--surface-border-strong)]'
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
            'hover:[&>td]:bg-zinc-950/[0.03] hover:[&>th]:bg-zinc-950/[0.03] dark:hover:[&>td]:bg-surface-raised-hover dark:hover:[&>th]:bg-surface-raised-hover has-[[data-row-link][data-focus]]:outline-2 has-[[data-row-link][data-focus]]:-outline-offset-2 has-[[data-row-link][data-focus]]:outline-accent-500 dark:focus-within:[&>td]:bg-surface-raised-hover',
          striped && 'even:[&>td]:bg-zinc-950/2 dark:even:[&>td]:bg-white/[0.02]'
        )}
      />
    </TableRowContext.Provider>
  )
}

export function TableHeader({ className, ...props }: React.ComponentPropsWithoutRef<'th'>) {
  let { bleed, grid } = useContext(TableContext)

  return (
    <th
      // `scope="col"` states the association a screen reader cannot infer from a
      // bare <th>: every cell below this one is described by it. Declared BEFORE
      // the spread on purpose — a <th> that spans several columns (colSpan) is a
      // group header, and `scope="colgroup"` (or none) is then correct; putting
      // the default first lets such a caller override it instead of being locked
      // into a wrong scope. No dashboard table spans header cells today.
      scope="col"
      {...props}
        className={clsx(
          className,
          // NOTE: the 10px/uppercase/tracking-widest header type DIVERGES from the
          // stock Catalyst kit (font-medium at body size). That divergence is a
          // deliberate house style, not drift to repair — this file only adds
          // invisible semantics (scope, caption) and must not restyle anything.
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
        // white/5 was too faint to read as a separator at all; white/8 keeps the
        // rows soft-edged but actually divided.
        !striped && 'border-b border-zinc-950/5 dark:border-[var(--surface-border)]',
        grid && 'border-l border-l-zinc-950/5 first:border-l-0 dark:border-l-[var(--surface-border)]',
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
