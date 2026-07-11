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
      {/* Header — FRANC orange band (directive Adrien) : voile accent à 30/35%
          sur la teinte CLAIRE (accent-400 en dark) pour que l'orange ressorte
          net, jamais le marron désaturé qu'un cuivre foncé à basse opacité
          produisait. La heat-bar verticale + le titre neutre restent. */}
      <div className="relative border-b border-accent-500/30 bg-accent-500/30 px-6 py-4 dark:border-accent-400/25 dark:bg-accent-400/35">
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
