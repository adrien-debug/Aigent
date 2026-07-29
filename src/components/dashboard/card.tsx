import { cn } from '@/components/ui/cn'

/**
 * The one card primitive of the admin home. The frame repeats a single graphite
 * plate — same radius, same surface, same hairline — for every section, so the
 * plate is written once here and composed everywhere else.
 *
 * These four are deliberately dumb: no data, no state, no logic, no variants.
 * Anything conditional belongs to the section that owns the data. Defaults come
 * FIRST and the caller's `className` LAST in every `cn()` call, so a caller can
 * always override (see the note in `src/components/ui/cn.ts`).
 */

/** The plate itself. */
export function Card({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className={cn('overflow-hidden rounded-2xl border border-line bg-card', className)}
    />
  )
}

/** Dense header row: title slot on the left, optional actions flushed right. */
export function CardHeader({
  className,
  actions,
  children,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { actions?: React.ReactNode }) {
  return (
    <div
      {...props}
      className={cn('flex items-center justify-between gap-3 px-5 pt-5 pb-3', className)}
    >
      {children}
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/** The small section title used across the frame, with an optional icon slot. */
export function CardTitle({
  className,
  icon,
  children,
  ...props
}: React.ComponentPropsWithoutRef<'h2'> & { icon?: React.ReactNode }) {
  return (
    <h2 {...props} className={cn('flex items-center gap-2 text-sm font-semibold text-white', className)}>
      {icon ? (
        <span className="flex shrink-0 items-center text-zinc-400 [&_svg]:size-4">{icon}</span>
      ) : null}
      {children}
    </h2>
  )
}

/** Card content, with the default vertical rhythm of the frame. */
export function CardBody({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={cn('flex flex-col gap-4 px-5 pb-5', className)} />
}
