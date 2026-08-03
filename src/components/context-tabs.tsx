/**
 * Sous-navigation d'un OBJET — la barre d'onglets des fiches Agent et Projet.
 *
 * POURQUOI ELLE EXISTE (AIGENT-UX-IA-001, #93). Runtime, Qualification,
 * Learning et Livraison étaient des entrées globales : le menu exposait des
 * FONCTIONS comme si c'étaient des produits, alors que ce sont des facettes
 * d'un agent ou d'un projet. « La qualification de quoi ? » n'avait pas de
 * réponse avant d'avoir cliqué. Elles redeviennent ici des onglets de l'objet
 * concerné, où la question ne se pose plus.
 *
 * DES LIENS, PAS UN ÉTAT LOCAL — repris de `runtime/tab-bar.tsx`, dont ce
 * composant est la généralisation. L'onglet courant vit dans l'URL, donc le
 * deep link marche, le rechargement marche, le bouton retour marche, et la
 * surface reste un Server Component. Un `useState` aurait rendu ces quatre
 * choses fausses d'un coup.
 *
 * UN ONGLET PEUT MENER AILLEURS. `href` est une route complète, pas un
 * fragment : « Livraisons » sur une fiche Agent pointe vers `/delivery/:id`,
 * qui existe déjà et porte tout l'écran. On ne réimplémente pas ces surfaces
 * dans un onglet — on les rattache à l'objet dont elles parlent. C'est ce qui
 * permet de simplifier le menu SANS perdre une seule capacité.
 */
import clsx from 'clsx'

import { Link } from '@/components/ui/link'

export type ContextTab = {
  id: string
  name: string
  href: string
  /** Ce que l'onglet porte — rendu en `title`, jamais seul porteur d'information. */
  purpose?: string
}

export default function ContextTabs({
  tabs,
  current,
  label,
  className,
}: Readonly<{
  tabs: readonly ContextTab[]
  /** `id` de l'onglet courant. */
  current: string
  /** Nom accessible de la barre — « Sections de la fiche Agent ». */
  label: string
  className?: string
}>) {
  return (
    <nav aria-label={label} className={clsx('min-w-0 shrink-0', className)}>
      {/*
        `overflow-x-auto` est un débordement de BARRE D'ONGLETS, pas un scroller
        de contenu : à 375 px, sept onglets ne tiennent pas, et les replier sur
        deux lignes ferait sauter la hauteur de l'en-tête d'un objet à l'autre.
        L'issue interdit le scroll interne dans les BLOCS du dashboard — celui-ci
        est une navigation, et c'est le même compromis que `/runtime` tenait
        déjà.
      */}
      <ul className="scroll-thin flex min-w-0 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === current
          return (
            <li key={tab.id} className="shrink-0">
              <Link
                href={tab.href}
                title={tab.purpose}
                // `aria-current` porte l'état pour un lecteur d'écran : la
                // couleur seule ne dit pas « vous êtes ici ».
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'block rounded-md px-3 py-1.5 text-sm/6 font-medium no-underline',
                  active ? 'aig-raised aig-text' : 'aig-text-muted hover:aig-raised',
                )}
              >
                {tab.name}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
