import clsx from 'clsx'

import { GAP_FAMILIES, PADDING_BOTTOM_FAMILIES, callerSets } from '@/components/shell/class-defaults'

/**
 * Vertical rhythm shared by every /admin page: a flex column, a default gap and
 * a default bottom breathing room.
 *
 * `gap-4` and `pb-8` are DEFAULTS the caller may replace. They used to be
 * layered as `clsx('flex flex-col gap-4 pb-8', className)`, which only appeared
 * to work: `gap-8`/`pb-12` win because Tailwind emits the larger step later in
 * the compiled sheet, while `<PageLayout className="… gap-4 pb-0">` (the team
 * tab) lost its `pb-0` to `pb-8` and carried 32px of dead space under a pane
 * that is meant to end flush. Same defect, opposite outcome, decided by nothing
 * more than which number sorts last. The default is now suppressed when the
 * caller states the family — see class-defaults.ts.
 */
export function PageLayout({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={clsx(
        'flex flex-col',
        !callerSets(className, GAP_FAMILIES) && 'gap-4',
        !callerSets(className, PADDING_BOTTOM_FAMILIES) && 'pb-8',
        className
      )}
    >
      {children}
    </div>
  )
}
