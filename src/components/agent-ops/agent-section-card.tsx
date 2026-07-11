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
      {/* Header — copper LANGUAGE, not a heavy banner: a soft copper wash
          (--copper-surface) capped by a bright copper hairline, with a short
          vertical copper heat-bar flagging the section title. Reads warm and
          premium instead of a full-fill orange block; the heat-bar + hairline
          carry the accent so the title can stay high-contrast neutral. */}
      <div className="relative border-b border-[var(--copper-line)] bg-[var(--copper-surface)] px-6 py-4">
        <div className="-mt-2 -ml-4 flex flex-wrap items-center justify-between sm:flex-nowrap sm:items-start">
          <div className="mt-2 ml-4 flex min-w-0 items-start gap-3">
            <span aria-hidden="true" className="mt-1 h-4 w-0.5 shrink-0 rounded-full bg-accent-500 dark:bg-accent-400" />
            <div className="min-w-0">
              <Subheading className="text-zinc-950! dark:text-white!">{title}</Subheading>
              {description ? <Text className="mt-1">{description}</Text> : null}
            </div>
          </div>
          {actions ? <div className="mt-2 ml-4 flex shrink-0 items-center gap-3">{actions}</div> : null}
        </div>
      </div>
      <div className={contentClassName ?? 'px-6 py-5'}>{children}</div>
    </section>
  )
}
