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
  /**
   * ReactNode (et pas `string`) : un titre de carte peut porter un micro-style
   * légitime — un id de run en `font-mono tabular-nums`, un label + un tag inline.
   * Un `string` reste un ReactNode valide, donc tous les appelants existants
   * continuent de marcher à l'identique.
   */
  title: React.ReactNode
  description?: React.ReactNode
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
        'overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/5 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]',
        className
      )}
    >
      {/* Header — PAS de bande de fond (le voile orange brunissait sur le noir,
          directive Adrien). L'accent orange est porté par la heat-bar verticale
          + une hairline orange nette en bas ; fond transparent comme le corps. */}
      <div className="relative border-b border-zinc-950/5 bg-zinc-50/50 px-6 py-4 dark:border-white/5 dark:bg-white/[0.01]">
        <div className="-mt-2 -ml-4 flex flex-wrap items-center justify-between sm:flex-nowrap sm:items-start">
          <div className="mt-2 ml-4 flex min-w-0 items-start gap-3">
            <div className="min-w-0">
              {/* H2 → orange accent, géré par le défaut du composant Subheading. */}
              <Subheading className="tracking-tight">{title}</Subheading>
              {description ? <Text className="mt-1 tracking-tight">{description}</Text> : null}
            </div>
          </div>
          {actions ? <div className="mt-2 ml-4 flex shrink-0 items-center gap-3">{actions}</div> : null}
        </div>
      </div>
      <div className={contentClassName ?? 'px-6 py-6'}>{children}</div>
    </section>
  )
}
