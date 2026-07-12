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
  /**
   * Échappatoire au padding canon (`px-6 py-5`) — réservée aux cas où le
   * contenu porte déjà son propre rythme horizontal, typiquement une
   * `<Table bleed>` qui a besoin de `px-6 py-4` ou `p-0`. Ne PAS l'utiliser
   * pour ajuster arbitrairement l'espacement d'un contenu ordinaire : le
   * défaut `px-6 py-5` est le canon DS.
   */
  contentClassName?: string
}) {
  return (
    <section
      className={clsx(
        'overflow-hidden rounded-xl bg-white ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10',
        className
      )}
    >
      {/* Header — PAS de bande de fond (le voile orange brunissait sur le noir,
          directive Adrien). L'accent orange est porté par la heat-bar verticale
          + une hairline orange nette en bas ; fond transparent comme le corps. */}
      <div className="relative border-b border-accent-500/60 px-6 py-4 dark:border-accent-400/60">
        <div className="-mt-2 -ml-4 flex flex-wrap items-center justify-between sm:flex-nowrap sm:items-start">
          <div className="mt-2 ml-4 flex min-w-0 items-start gap-3">
            <span aria-hidden="true" className="mt-1 h-4 w-0.5 shrink-0 rounded-full bg-accent-500 dark:bg-accent-400" />
            <div className="min-w-0">
              {/* H2 → orange accent, géré par le défaut du composant Subheading. */}
              <Subheading>{title}</Subheading>
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
