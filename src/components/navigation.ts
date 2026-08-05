/**
 * Carte de navigation d'Aigent — source UNIQUE des onze surfaces du plan de
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
  AcademicCapIcon,
  BeakerIcon,
  BoltIcon,
  Cog6ToothIcon,
  CpuChipIcon,
  FolderIcon,
  InboxStackIcon,
  LifebuoyIcon,
  RocketLaunchIcon,
  SignalIcon,
  Squares2X2Icon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/20/solid'

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
 * LE CATALOGUE DES SURFACES — toutes les routes nommées du plan de contrôle.
 *
 * AIGENT-UX-IA-001 (#93) sépare deux rôles que cette table confondait :
 *
 *  · NOMMER une surface (titre de page, `metadata.title`, libellé d'un lien
 *    contextuel). Vingt-et-un fichiers appellent `navEntry(href)` pour ça, dont
 *    des pages que la nouvelle architecture retire du menu.
 *  · LA LISTER dans le menu principal, qui doit tomber à six entrées.
 *
 * Retirer une surface du MENU ne la supprime pas du PRODUIT : « ne plus être une
 * entrée globale autonome » n'est pas « ne plus exister ». Le catalogue reste
 * donc complet — c'est `MAIN_NAVIGATION` qui décide ce qui s'affiche à gauche.
 * Sans cette séparation, retirer une entrée casserait la compilation des pages
 * qui la nomment, et l'issue exige explicitement « aucune capability perdue ».
 *
 * `satisfies` plutôt qu'une annotation : le tableau garde son type littéral, ce
 * qui permet à `NavHref` d'être l'union exacte des routes. Une page qui demande
 * `navEntry('/typo')` ne compile alors PAS — au lieu de rendre `undefined` et
 * d'exploser au rendu.
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
    name: 'Learning',
    href: '/learning',
    icon: AcademicCapIcon,
    purpose:
      "Supervision de la flotte, file de revue, état des évaluations et accès à la connaissance — le poste d'amélioration des agents.",
  },
  {
    name: 'Actions',
    href: '/actions',
    icon: InboxStackIcon,
    purpose: "File d'action complète — la colonne de l'aperçu, sans troncature.",
  },
  {
    name: 'Support',
    href: '/support',
    icon: LifebuoyIcon,
    purpose:
      'Incidents, agents dégradés et signaux qui demandent une intervention — ce qui va mal, rassemblé.',
  },
  {
    name: 'Réglages',
    href: '/settings',
    icon: Cog6ToothIcon,
    purpose: 'Configuration du plan de contrôle, jetons et frontières de confiance.',
  },
] as const satisfies readonly NavEntry[]

/** L'union exacte des routes du catalogue — pas `string`. */
export type NavHref = (typeof NAVIGATION)[number]['href']

/**
 * LE MENU PRINCIPAL — six entrées, et rien d'autre.
 *
 * L'ordre est celui du parcours opérateur : on regarde l'état (Aperçu), puis
 * les objets qu'on pilote (Agents, Projets), puis ce qu'ils ont produit (Runs),
 * puis ce qui ne va pas (Support), puis la configuration (Réglages).
 *
 * CE QUI A QUITTÉ LE MENU, ET OÙ C'EST PARTI. Aucune de ces surfaces n'est
 * supprimée : chacune devient contextuelle à l'objet qu'elle concerne, ce qui
 * est précisément la demande de l'issue — elles étaient exposées comme des
 * produits séparés alors que ce sont des facettes d'un agent ou d'un projet.
 *
 *   Runtime        → onglet de la fiche Agent (+ route `/runtime` conservée)
 *   Qualification  → onglet de la fiche Agent (+ `/qualification` conservée)
 *   Learning       → onglet de la fiche Agent (+ `/learning` conservée)
 *   Livraison      → onglet de la fiche Agent et de la fiche Projet
 *   Builder        → action depuis la fiche Projet et le roster d'agents
 *   Actions        → la file d'action vit dans l'Aperçu et dans Support
 *
 * LES ROUTES RESTENT TOUTES ACCESSIBLES. Un lien profond, un signet ou un lien
 * contextuel continuent de fonctionner : retirer une entrée de menu ne doit
 * jamais casser une URL que quelqu'un a gardée.
 */
export const MAIN_NAVIGATION = [
  '/',
  '/agents',
  '/projects',
  '/runs',
  '/support',
  '/settings',
] as const satisfies readonly NavHref[]

/** Les entrées réellement rendues dans le rail, dans l'ordre du parcours. */
export const MAIN_NAV_ENTRIES: readonly NavEntry[] = MAIN_NAVIGATION.map((href) => {
  const entry = NAVIGATION.find((candidate) => candidate.href === href)
  if (!entry) throw new Error(`MAIN_NAVIGATION: route absente du catalogue — ${href}`)
  return entry
})

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
  for (const href of MAIN_NAVIGATION) {
    if (href === '/') continue
    if (pathname === href || pathname.startsWith(`${href}/`)) {
      if (best === null || href.length > best.length) best = href
    }
  }
  if (best !== null) return best

  // SURFACE HORS MENU — on remonte à l'entrée qui la contient.
  //
  // `/qualification/:id` concerne UN agent, `/delivery/:id` aussi : sans ce
  // rattachement, ouvrir une de ces routes éteindrait toute la navigation et
  // l'opérateur ne saurait plus dans quelle section il se trouve. Le rail doit
  // toujours répondre à « où suis-je », y compris sur une route qu'il ne liste
  // pas.
  return HOME_SECTION[pathname.split('/')[1] ?? ''] ?? null
}

/**
 * Le rattachement des surfaces hors menu à leur section de menu.
 *
 * Clé = premier segment du chemin. Une surface qui parle d'un AGENT s'allume
 * sur « Agents », une qui parle d'un PROJET sur « Projets ». `/actions` remonte
 * sur Support : la file d'action est ce qui demande une intervention.
 */
const HOME_SECTION: Readonly<Record<string, string>> = {
  qualification: '/agents',
  delivery: '/agents',
  runtime: '/agents',
  learning: '/agents',
  builder: '/projects',
  actions: '/support',
}

/**
 * La fiche d'une surface, pour qu'une page nomme exactement ce que la nav nomme.
 *
 * Le paramètre est typé `NavHref`, donc une route absente de la carte est une
 * ERREUR DE COMPILATION, pas un `undefined` qui casserait au rendu. C'est ce qui
 * autorise le retour non-nullable : le `find` ne peut pas échouer sur une valeur
 * que le type a déjà restreinte aux onze `href` du tableau.
 */
export function navEntry(href: NavHref): NavEntry {
  const entry = NAVIGATION.find((candidate) => candidate.href === href)
  // Inatteignable par typage ; garde explicite plutôt qu'un `!` muet.
  if (!entry) throw new Error(`navEntry: route absente de NAVIGATION — ${href}`)
  return entry
}
