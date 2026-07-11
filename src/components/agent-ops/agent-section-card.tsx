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
      {/* Bandeau de header en voile accent orange (directive Adrien 2026-07-11) :
          voile à 35% pour que l'orange ressorte franchement — à 15% le noir du fond
          désaturait le vermillon vers le marron. */}
      <div className="border-b border-accent-500/30 bg-accent-500/30 px-6 py-4 dark:border-accent-400/25 dark:bg-accent-400/35">
        <div className="-mt-2 -ml-4 flex flex-wrap items-center justify-between sm:flex-nowrap sm:items-start">
          <div className="mt-2 ml-4 min-w-0">
            {/* Titre en BLANC sur le bandeau à fond orange (directive Adrien
                2026-07-11) — le fond porte la couleur, le titre reste neutre. */}
            <Subheading className="text-zinc-950! dark:text-white!">{title}</Subheading>
            {description ? <Text className="mt-1">{description}</Text> : null}
          </div>
          {actions ? <div className="mt-2 ml-4 flex shrink-0 items-center gap-3">{actions}</div> : null}
        </div>
      </div>
      <div className={contentClassName ?? 'px-6 py-5'}>{children}</div>
    </section>
  )
}
