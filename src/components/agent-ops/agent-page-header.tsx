import clsx from 'clsx'

import { Heading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'

/**
 * AgentPageHeader — the ONE page-header rhythm for every /admin screen
 * (directive Adrien 2026-07-11). Identical structure on all pages so the top
 * of every page aligns to the pixel: title + optional description on the left,
 * optional actions pinned right, a hairline underneath, then the KPI band.
 *
 * No box, no background — it lives directly on the grey body, matching the
 * doctrine (KPI band and content are the framed surfaces, not the header).
 * The `-mt-1` pulls the title up so the header baseline sits at a consistent
 * height regardless of whether actions are present.
 */
export function AgentPageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={clsx(
        'flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-zinc-950/5 pb-6 dark:border-white/5 dark:shadow-[0_1px_0_rgba(255,255,255,0.02)]',
        className
      )}
    >
      <div className="min-w-0">
        <Heading level={1} className="tracking-tight">{title}</Heading>
        {description ? <Text className="mt-1.5 tracking-tight">{description}</Text> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
    </div>
  )
}
