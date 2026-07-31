/**
 * La barre des six onglets de `/runtime`.
 *
 * DES LIENS, PAS UN ÉTAT LOCAL. L'onglet courant vit dans le query param, donc
 * chaque onglet est un `<Link>` vers une URL réelle : le deep link marche, le
 * rechargement direct marche, le bouton retour marche, et l'entrée de nav
 * « Runtime » reste active parce que le pathname ne bouge jamais. Un `useState`
 * aurait rendu ces quatre choses fausses d'un coup, et forcé la surface entière
 * à devenir cliente alors qu'elle lit en Server Component.
 *
 * Conséquence assumée : changer d'onglet est une navigation, donc chaque onglet
 * ne lit QUE sa propre donnée. C'est voulu — une surface qui lit six backends
 * pour n'en afficher qu'un sixième paie six fois le prix d'une panne.
 */
import clsx from 'clsx'

import { Link } from '@/components/ui/link'
import { RUNTIME_TABS, runtimeTabHref, type RuntimeTabId } from './model'

export default function RuntimeTabBar({ current }: Readonly<{ current: RuntimeTabId }>) {
  return (
    <nav aria-label="Sections de la surface Runtime" className="min-w-0 shrink-0">
      <ul className="scroll-thin flex min-w-0 items-center gap-1 overflow-x-auto">
        {RUNTIME_TABS.map((tab) => {
          const active = tab.id === current
          return (
            <li key={tab.id} className="shrink-0">
              <Link
                href={runtimeTabHref(tab.id)}
                title={tab.purpose}
                // `aria-current` porte l'état pour un lecteur d'écran : la
                // couleur seule ne dit pas « vous êtes ici ».
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'block rounded-md px-3 py-1.5 text-sm/6 font-medium no-underline',
                  active
                    ? 'bg-zinc-950/5 text-zinc-950 dark:bg-white/10 dark:text-white'
                    : 'text-zinc-500 hover:bg-zinc-950/3.5 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white',
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
