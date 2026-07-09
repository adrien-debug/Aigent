import clsx from 'clsx'

import { Subheading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'

export function AgentSectionCard({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <section
      className={clsx(
        'overflow-hidden rounded-xl bg-white ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10',
        className
      )}
    >
      <div className="border-b border-zinc-950/5 px-6 py-4 dark:border-white/5">
        <div className="-mt-2 -ml-4 flex flex-wrap items-center justify-between sm:flex-nowrap">
          <div className="mt-2 ml-4 min-w-0">
            <Subheading>{title}</Subheading>
            {description ? <Text className="mt-1">{description}</Text> : null}
          </div>
          {actions ? <div className="mt-2 ml-4 flex shrink-0 items-center gap-3">{actions}</div> : null}
        </div>
      </div>
      <div className={contentClassName ?? 'px-6 py-5'}>{children}</div>
    </section>
  )
}
