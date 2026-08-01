/**
 * Le catalogue du laboratoire d'interaction — donnée pure, aucun rendu.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * `/lab` est un banc d'essai : on y pose un pattern d'interaction AVANT de
 * décider s'il mérite d'entrer dans une surface produit. Sans cet endroit,
 * chaque idée coûte soit une page jetable hors du repo (invérifiable, écrite
 * dans un autre langage que le produit), soit un branchement direct dans un
 * écran réel — c'est-à-dire un risque pris sur du code que personne n'a encore
 * vu bouger.
 *
 * CE QUE `/lab` N'EST PAS
 * -----------------------
 * · Ce n'est PAS une surface produit. Elle n'est pas dans `NAVIGATION` et ne le
 *   sera jamais : la carte de navigation décrit le plan de contrôle, pas les
 *   outils de fabrication. On y accède en tapant l'URL.
 * · Ce n'est PAS une gate visuelle, ni un design system, ni un Storybook.
 *   `AGENTS.md` § Frontend interdit d'en réintroduire un sans mission dédiée,
 *   et ce fichier ne le contourne pas : rien ici n'est imposé à un écran.
 * · Ce n'est PAS de la donnée réelle. Chaque pattern tourne sur des fixtures
 *   nommées comme telles. Aucun appel réseau, aucune lecture de la flotte —
 *   un banc d'essai qui interroge la production mentirait deux fois : sur la
 *   charge qu'il crée, et sur ce que l'écran montre.
 *
 * `status` dit où en est chaque pattern, et c'est la seule information qui
 * compte pour décider quoi faire ensuite. Un pattern `adopted` est déjà dans
 * une surface produit — le lab n'en est plus que la vitrine.
 */

/**
 * L'état d'un pattern vis-à-vis du produit.
 *
 * `adopted` est une affirmation FORTE : elle dit qu'un écran réel s'en sert
 * aujourd'hui. Elle porte donc toujours le chemin du consommateur, pour qu'on
 * puisse la vérifier plutôt que la croire.
 */
export type PatternStatus = 'adopted' | 'candidate' | 'exploration'

export const PATTERN_STATUS_LABEL: Record<PatternStatus, string> = {
  adopted: 'En production',
  candidate: 'Candidat',
  exploration: 'Exploration',
}

export const PATTERN_STATUS_MEANING: Record<PatternStatus, string> = {
  adopted:
    'Ce pattern est déjà utilisé par une surface produit. Le lab n’en est que la vitrine — le modifier ici ne change rien à l’écran réel.',
  candidate:
    'Ce pattern est prêt techniquement et attend une décision : quel écran l’adopte, et à quel prix. Rien ne le consomme aujourd’hui.',
  exploration:
    'Ce pattern est là pour être regardé et probablement jeté. Il n’a pas encore de coût chiffré ni d’écran candidat.',
}

export interface LabPattern {
  /** Identifiant d'ancre dans l'URL — `#morph`, jamais un index de position. */
  id: string
  name: string
  /** Ce que le pattern fait, en une phrase, du point de vue de l'opérateur. */
  purpose: string
  status: PatternStatus
  /**
   * Où ce pattern vit déjà dans le produit. OBLIGATOIRE quand `status` vaut
   * `adopted` — une adoption qu'on ne peut pas pointer du doigt est une
   * affirmation invérifiable, exactement ce que ce repo refuse ailleurs.
   */
  usedBy?: string
  /** Ce que le pattern coûte, honnêtement, s'il faut le porter en production. */
  cost: string
  /**
   * Ce qu'il casse, ce qu'il exige, ou ce qu'il ne sait pas faire. Jamais vide :
   * un pattern sans contrepartie connue est un pattern pas encore étudié.
   */
  caveat: string
}

export const LAB_PATTERNS = [
  {
    id: 'morph',
    name: 'Ligne → fiche (morph partagé)',
    purpose:
      'Une ligne de roster se déplie en fiche : l’avatar, le nom et le statut voyagent au lieu d’être redessinés, donc on ne perd jamais de vue quel agent on regarde.',
    status: 'candidate',
    cost: 'Moyen — la fiche doit devenir un panneau superposé, or /agents/:id est aujourd’hui une vraie route avec deep-link.',
    caveat:
      'Transformer la fiche en panneau supprimerait son URL propre. Le deep-link est une contrainte tenue partout dans ce produit (aucun `href="#"`, sélection portée par l’URL sur /runs) — il n’est pas négociable pour un effet visuel.',
  },
  {
    id: 'folder',
    name: 'Dossier qui s’ouvre (grappe d’agents)',
    purpose:
      'Un groupe d’agents s’ouvre depuis sa vignette : les quatre agents visibles morphent vers leur place, les autres jaillissent du centre en cascade.',
    status: 'exploration',
    cost: 'Élevé — le regroupement d’agents en « dossiers » n’existe pas dans le modèle de données.',
    caveat:
      'Le produit n’a pas de notion de dossier d’agents : un agent appartient à un PROJET, et un projet a déjà sa propre surface. Adopter ce pattern demanderait d’inventer un niveau de regroupement — décision produit, pas décision visuelle.',
  },
  {
    id: 'indicator',
    name: 'Indicateur de sélection glissant',
    purpose:
      'Le repère de l’entrée courante glisse d’un item à l’autre au lieu de sauter, ce qui rend le changement de section lisible.',
    status: 'adopted',
    usedBy: 'src/components/ui/sidebar.tsx · src/components/ui/navbar.tsx',
    cost: 'Nul — déjà en production dans le kit.',
    caveat:
      'Le kit est figé par empreinte SHA (`check:ui-kit-integrity`) : ce pattern se regarde ici, il ne se modifie pas depuis le lab.',
  },
  {
    id: 'progress',
    name: 'Remplissage de progression',
    purpose:
      'Un run en cours affiche son avancement réel — combien d’étapes sur combien — au lieu du seul badge « En cours », qui ne distingue pas un run qui avance d’un run figé.',
    status: 'candidate',
    cost: 'Moyen — les étapes existent en base (`agent_runs.stepIds`, `AgentRunStep.index`), mais aucun canal ne les pousse vers l’écran pendant l’exécution.',
    caveat:
      'Le total d’étapes n’est PAS connu tant que le graphe n’a pas fini : le pattern doit donc porter deux modes distincts, et le mode « total inconnu » ne doit jamais afficher de pourcentage. Une barre qui avance sans mesure — le défaut le plus courant de ce pattern — est ici interdite.',
  },
  {
    id: 'stagger',
    name: 'Cascade d’entrée de liste',
    purpose:
      'Les lignes d’une liste apparaissent en décalé après une lecture, pour signaler « ceci vient d’être lu » sans ajouter une ligne de texte.',
    status: 'exploration',
    cost: 'Faible — une vingtaine de lignes par liste concernée.',
    caveat:
      'À l’usage, une cascade rejouée à chaque navigation devient fatigante et retarde la lecture. Elle n’a de sens que sur une vraie relecture (rafraîchissement), pas sur un simple retour à la page.',
  },
] as const satisfies readonly LabPattern[]

export type LabPatternId = (typeof LAB_PATTERNS)[number]['id']

/**
 * Le compte par état — le seul chiffre affiché en tête du lab.
 *
 * Il est dérivé du tableau, jamais saisi à la main : un compteur écrit en dur
 * devient faux au premier pattern ajouté, et un banc d'essai qui ment sur son
 * propre contenu ne sert plus à rien.
 */
export function countByStatus(
  patterns: readonly LabPattern[] = LAB_PATTERNS,
): Record<PatternStatus, number> {
  const counts: Record<PatternStatus, number> = {
    adopted: 0,
    candidate: 0,
    exploration: 0,
  }
  for (const pattern of patterns) counts[pattern.status] += 1
  return counts
}
