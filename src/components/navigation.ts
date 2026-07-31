/**
 * Carte de navigation d'Aigent — source UNIQUE des dix surfaces du plan de
 * contrôle.
 *
 * Pourquoi un module à part, et pas un tableau dans `app-shell.tsx` :
 * le shell est `'use client'`, mais cette carte est de la donnée pure. La
 * sortir permet aux pages serveur (les placeholders de PR 1) de la lire pour
 * nommer leur propre surface sans dupliquer un libellé — un libellé dupliqué
 * dérive, et une nav qui dit « Livraison » sur une page qui s'intitule
 * « Delivery » est un mensonge de navigation.
 *
 * DEUX RÈGLES TENUES ICI
 * ----------------------
 * 1. `href` est OBLIGATOIRE. Il n'y a plus d'entrée sans cible : les
 *    `<SidebarItem disabled>` de l'état précédent étaient des `<button>` inertes
 *    qui dessinaient une carte du produit sans laisser y aller. Chaque entrée
 *    pointe désormais sur une route réelle — et cette route DIT honnêtement ce
 *    qu'elle ne sait pas encore faire, dans sa propre page.
 *
 *    Un champ `wired: boolean` a vécu ici, censé marquer les écrans branchés à
 *    une vraie lecture. Il n'a JAMAIS été lu par personne, et il est devenu faux
 *    au fur et à mesure que les surfaces atterrissaient — quatre entrées le
 *    portaient encore à `false` en lisant de la donnée réelle. Un drapeau que
 *    rien ne consomme ne se met pas à jour : il se supprime. L'état d'une
 *    surface se lit dans la surface, pas dans une table qui prétend la décrire.
 * 2. `href="#"` est interdit partout dans ce repo. Un `#` est un lien qui ment
 *    en ayant l'air de marcher ; une page placeholder ne ment pas, elle nomme
 *    son absence.
 *
 * LANGUE : libellés en FRANÇAIS, routes en ANGLAIS. C'est l'état existant du
 * produit (« File d'action », « Plan de contrôle », « Lecture de l'état de la
 * flotte ») et la table de correspondance F4 du master-plan, qui fixe déjà
 * `/agents/:id`, `/projects/:id`, `/projects/:id/builder` côté URL. On tranche
 * dans ce sens plutôt que de traduire des routes que d'autres PR consomment
 * déjà.
 */
import type { ComponentType, SVGProps } from 'react'
import {
  BeakerIcon,
  BoltIcon,
  Cog6ToothIcon,
  CpuChipIcon,
  FolderIcon,
  InboxStackIcon,
  RocketLaunchIcon,
  SignalIcon,
  Squares2X2Icon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline'

export type NavEntry = {
  /** Libellé affiché dans la sidebar ET titre de la surface. Un seul mot d'ordre. */
  name: string
  /** Route réelle. Jamais `undefined`, jamais `'#'`. */
  href: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  /** Ce que la surface est censée porter — repris tel quel par le placeholder. */
  purpose: string
}

/**
 * Les dix entrées, dans l'ordre imposé du parcours produit.
 *
 * `satisfies` plutôt qu'une annotation : le tableau garde son type littéral, ce
 * qui permet à `NavHref` d'être l'union exacte des dix routes. Une page qui
 * demande `navEntry('/typo')` ne compile alors PAS — au lieu de rendre
 * `undefined` et d'exploser au rendu.
 */
export const NAVIGATION = [
  {
    name: 'Aperçu',
    href: '/',
    icon: Squares2X2Icon,
    purpose: "État de la flotte sur la fenêtre 24 h et file d'action de l'opérateur.",
  },
  {
    name: 'Runs',
    href: '/runs',
    icon: BoltIcon,
    purpose: "Historique des exécutions : statut, latence, coût, outils appelés, trace d'un run.",
  },
  {
    name: 'Agents',
    href: '/agents',
    icon: CpuChipIcon,
    purpose: 'Roster des copilotes, leur runtime, leur version de production et leur santé.',
  },
  {
    name: 'Projets',
    href: '/projects',
    icon: FolderIcon,
    purpose: 'Projets consommateurs, leur dépôt cible et les agents qui leur sont rattachés.',
  },
  {
    name: 'Builder',
    href: '/builder',
    icon: WrenchScrewdriverIcon,
    purpose: "Conversation d'authoring : architecte, manifeste, matérialisation d'un agent.",
  },
  {
    name: 'Qualification',
    href: '/qualification',
    icon: BeakerIcon,
    purpose: 'Tests, benchmarks, release gate et promotion de version.',
  },
  {
    name: 'Livraison',
    href: '/delivery',
    icon: RocketLaunchIcon,
    purpose: 'Poussées vers les dépôts consommateurs, PR ouvertes, sandbox.',
  },
  {
    name: 'Runtime',
    href: '/runtime',
    icon: SignalIcon,
    purpose: 'Santé du canal de télémétrie et événements remontés par les agents déployés.',
  },
  {
    name: 'Actions',
    href: '/actions',
    icon: InboxStackIcon,
    purpose: "File d'action complète — la colonne de l'aperçu, sans troncature.",
  },
  {
    name: 'Réglages',
    href: '/settings',
    icon: Cog6ToothIcon,
    purpose: 'Configuration du plan de contrôle, jetons et frontières de confiance.',
  },
] as const satisfies readonly NavEntry[]

/** L'union exacte des dix routes de navigation — pas `string`. */
export type NavHref = (typeof NAVIGATION)[number]['href']

/**
 * L'entrée courante pour un pathname donné.
 *
 * Le segment le plus LONG qui préfixe le chemin gagne, pour qu'un futur
 * `/projects/:id/builder` s'illumine sur « Projets » et non sur « Builder ».
 * `/` est traité à part : sans ça, il préfixerait tout et resterait courant
 * partout.
 */
export function activeNavHref(pathname: string): string | null {
  if (pathname === '/') return '/'

  let best: string | null = null
  for (const entry of NAVIGATION) {
    if (entry.href === '/') continue
    if (pathname === entry.href || pathname.startsWith(`${entry.href}/`)) {
      if (best === null || entry.href.length > best.length) best = entry.href
    }
  }
  return best
}

/**
 * La fiche d'une surface, pour qu'une page nomme exactement ce que la nav nomme.
 *
 * Le paramètre est typé `NavHref`, donc une route absente de la carte est une
 * ERREUR DE COMPILATION, pas un `undefined` qui casserait au rendu. C'est ce qui
 * autorise le retour non-nullable : le `find` ne peut pas échouer sur une valeur
 * que le type a déjà restreinte aux dix `href` du tableau.
 */
export function navEntry(href: NavHref): NavEntry {
  const entry = NAVIGATION.find((candidate) => candidate.href === href)
  // Inatteignable par typage ; garde explicite plutôt qu'un `!` muet.
  if (!entry) throw new Error(`navEntry: route absente de NAVIGATION — ${href}`)
  return entry
}
