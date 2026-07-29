import { cn, responsiveDefault } from './cn'

/**
 * Catalyst `Table`, ported from the official kit
 * (`~/.claude/tailwind-blocks/catalyst/typescript/table.tsx`) — with the kit's
 * client-module marker REMOVED. That marker is the whole reason this file reads
 * differently from upstream, so here is exactly what was traded:
 *
 * WHY THE KIT IS A CLIENT MODULE. Two reasons, both mechanical. (1) `bleed` /
 * `dense` / `grid` / `striped` are declared on `<Table>` but consumed by
 * `<TableHeader>` / `<TableCell>` / `<TableRow>`, and the kit ships them
 * through a React context — `createContext` alone forces the client boundary.
 * (2) `TableCell` keeps a `useState` ref purely to decide which cell's overlay
 * link gets `tabIndex={0}` when a row is a link.
 *
 * WHAT THIS PORT DOES INSTEAD. The flags never change after render, so they do
 * not need runtime state: `<Table>` resolves them into CSS on the `<table>`
 * element itself and the parts style themselves from there. Nothing hydrates,
 * and a five-row table stops shipping twenty client component instances for
 * zero interactivity.
 *
 *   - `dense` travels as the custom property `--table-cell-py`, NOT as a
 *     descendant selector. That distinction is the whole point: `TableCell`
 *     keeps a BARE `py-…` class, so `tailwind-merge` can drop it when a caller
 *     passes `py-2` — a `[&_td]:py-2.5` on the root would have out-specified
 *     every caller override (`./cn` documents that exact trap).
 *   - `bleed` / `grid` / `striped` DO use descendant selectors on the root.
 *     They are whole-table modes, not per-cell values; out-specifying a cell is
 *     the intent there, and it is what the kit's context did too.
 *
 * WHAT WAS DROPPED. `TableRow`'s `href`/`target`/`title` row-link. It is the
 * only feature that genuinely needs client state, it has no consumer on this
 * screen, and a link inside the first cell is both simpler and better for
 * assistive tech. If a row must become a link, put a `<Link>` in the name cell.
 *
 * Dark is the only branch that ever renders (`.dark` is hard-set on `<html>`);
 * the light half is kept so the file stays diffable against the kit.
 */
export function Table({
  bleed = false,
  dense = false,
  grid = false,
  striped = false,
  className,
  children,
  ...props
}: { bleed?: boolean; dense?: boolean; grid?: boolean; striped?: boolean } & React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div className="flow-root">
      {/* `className` lands on the scroll container, as upstream: it is the box
          that owns width and overflow. A text size meant for the ROWS belongs
          on `TableHead` / `TableCell`, not here — `text-sm/6` below would
          out-cascade it. */}
      <div {...props} className={cn('-mx-(--gutter) overflow-x-auto whitespace-nowrap', className)}>
        <div className={cn('inline-block min-w-full align-middle', !bleed && 'sm:px-(--gutter)')}>
          <table
            className={cn(
              'min-w-full text-left text-sm/6 text-zinc-950 dark:text-white',
              dense ? '[--table-cell-py:calc(var(--spacing)*2.5)]' : '[--table-cell-py:calc(var(--spacing)*4)]',
              !bleed && 'sm:[&_:is(th,td):first-child]:pl-1 sm:[&_:is(th,td):last-child]:pr-1',
              grid &&
                '[&_:is(th,td)]:border-l [&_:is(th,td)]:border-l-zinc-950/5 [&_:is(th,td):first-child]:border-l-0 dark:[&_:is(th,td)]:border-l-white/5',
              striped &&
                '[&_tbody_td]:border-b-0 [&_tbody_tr:nth-child(even)]:bg-zinc-950/2.5 dark:[&_tbody_tr:nth-child(even)]:bg-white/2.5'
            )}
          >
            {children}
          </table>
        </div>
      </div>
    </div>
  )
}

export function TableHead({ className, ...props }: React.ComponentPropsWithoutRef<'thead'>) {
  return <thead {...props} className={cn('text-zinc-500 dark:text-zinc-400', className)} />
}

export function TableBody(props: React.ComponentPropsWithoutRef<'tbody'>) {
  return <tbody {...props} />
}

/**
 * Deliberately thin: row striping is resolved on the `<table>` (see `Table`)
 * and the row-link is gone, so a row carries no default of its own. It stays a
 * named part because the caller-facing API is `Table/TableHead/TableBody/
 * TableRow/TableHeader/TableCell` — a raw `<tr>` in the middle of that reads as
 * an accident, and this is where row-level classes belong.
 */
export function TableRow({ className, ...props }: React.ComponentPropsWithoutRef<'tr'>) {
  return <tr {...props} className={cn(className)} />
}

export function TableHeader({ className, ...props }: React.ComponentPropsWithoutRef<'th'>) {
  return (
    <th
      {...props}
      // The hairline colour goes through `responsiveDefault` for the same
      // reason as in `divider.tsx`: a bare `border-line` from the caller beats
      // the light half only, and dark is the branch that renders.
      className={cn(
        'border-b px-4 py-2 font-medium first:pl-(--gutter,--spacing(2)) last:pr-(--gutter,--spacing(2))',
        responsiveDefault('border-b-zinc-950/10', 'dark:border-b-white/10', className),
        className
      )}
    />
  )
}

export function TableCell({ className, ...props }: React.ComponentPropsWithoutRef<'td'>) {
  return (
    <td
      {...props}
      // `py-(--table-cell-py,…)` carries the fallback so a cell rendered
      // outside a `<Table>` still has padding instead of collapsing to 0.
      className={cn(
        'relative border-b px-4 py-(--table-cell-py,calc(var(--spacing)*4)) first:pl-(--gutter,--spacing(2)) last:pr-(--gutter,--spacing(2))',
        responsiveDefault('border-zinc-950/5', 'dark:border-white/5', className),
        className
      )}
    />
  )
}
