import { cn } from './cn'

export function Table({
  className,
  dense,
  caption,
  children,
  ...props
}: React.ComponentPropsWithoutRef<'table'> & { dense?: boolean; caption?: string }) {
  return (
    <div className="overflow-x-auto">
      <table {...props} className={cn('min-w-full text-left text-sm text-content-muted', dense && '[&_td]:py-2.5', className)}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  )
}

export function TableHead(props: React.ComponentPropsWithoutRef<'thead'>) {
  return <thead {...props} className={cn('border-b border-line text-xs font-semibold uppercase tracking-wide text-content-subtle', props.className)} />
}

export function TableBody(props: React.ComponentPropsWithoutRef<'tbody'>) {
  return <tbody {...props} className={cn('divide-y divide-line', props.className)} />
}

export function TableRow(props: React.ComponentPropsWithoutRef<'tr'>) {
  return <tr {...props} className={cn('transition hover:bg-surface-hover/40', props.className)} />
}

export function TableHeader(props: React.ComponentPropsWithoutRef<'th'>) {
  return <th {...props} className={cn('px-5 py-3 font-medium first:pl-6 last:pr-6', props.className)} />
}

export function TableCell(props: React.ComponentPropsWithoutRef<'td'>) {
  return <td {...props} className={cn('whitespace-nowrap px-5 py-3 first:pl-6 last:pr-6', props.className)} />
}
