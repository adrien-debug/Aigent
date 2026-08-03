import type { ReactNode } from 'react'
import clsx from 'clsx'

/**
 * Section plate de l'Aperçu — un filet, un titre, du contenu. Pas de panneau.
 *
 * EN-TÊTE SUR UNE SEULE LIGNE, délibérément. Le titre et son indice vivaient
 * empilés : deux sections voisines dont l'une portait un indice plus long
 * n'avaient alors plus la même hauteur d'en-tête, et le contenu des deux
 * colonnes démarrait sur deux lignes différentes. Titre + indice + action sur
 * une ligne unique rendent cette hauteur INDÉPENDANTE du texte, donc les
 * colonnes partagent le même axe supérieur par construction et non par
 * `min-height` accordée à la main.
 *
 * Le filet inférieur est le seul trait de la section : c'est lui qui donne
 * l'axe commun, à la place du cadre.
 */
export function OverviewSection({
  title,
  hint,
  actions,
  children,
  className,
}: Readonly<{
  title: string
  hint?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}>) {
  return (
    <section className={clsx('flex min-w-0 flex-col', className)}>
      <div className="aig-line-soft flex min-w-0 items-baseline justify-between gap-x-4 border-b pb-2.5">
        <div className="flex min-w-0 items-baseline gap-x-2.5">
          <h3 className="aig-text truncate text-sm font-semibold tracking-[-0.01em]">{title}</h3>
          {hint ? (
            <p className="aig-text-muted shrink-0 text-2xs uppercase tracking-[0.1em]">{hint}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="mt-3 flex min-w-0 flex-col">{children}</div>
    </section>
  )
}
