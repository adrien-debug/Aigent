/**
 * Fixtures du laboratoire — données INVENTÉES, jamais une lecture de la flotte.
 *
 * Le nom du module est le garde-fou : rien ici ne doit pouvoir être confondu
 * avec une mesure. Les agents portent des noms explicitement fictifs et les
 * chiffres sont choisis pour exercer les cas limites du rendu (une valeur
 * absente, un compteur à zéro, un statut dégradé), pas pour décrire une flotte
 * plausible.
 *
 * RÈGLE TENUE ICI, comme partout ailleurs dans ce produit : `null` signifie
 * « non mesuré » et se rend comme tel. Une fixture qui remplirait tous ses
 * champs entraînerait à ne jamais voir l'état d'absence — c'est-à-dire à
 * concevoir des écrans qui cassent au premier trou de données réel.
 */

export interface LabAgent {
  id: string
  initials: string
  name: string
  project: string
  status: 'active' | 'degraded' | 'inactive'
  runs24h: number
  /** `null` = aucun run terminal sur la fenêtre, donc aucun taux calculable. */
  successRate: number | null
  /** `null` = aucun run n'a porté de coût mesurable. */
  costUsd: number | null
  /** Les raisons concrètes pour lesquelles la garde d'exécution refuserait. */
  runBlockers: readonly string[]
}

export const LAB_AGENTS: readonly LabAgent[] = [
  {
    id: 'fixture-architect',
    initials: 'AM',
    name: 'Architecte de manifeste',
    project: 'Aigent · interne',
    status: 'active',
    runs24h: 128,
    successRate: 0.94,
    costUsd: 4.12,
    runBlockers: [],
  },
  {
    id: 'fixture-pricer',
    initials: 'PD',
    name: 'Pricer dropship',
    project: 'Dropship Factory',
    status: 'degraded',
    runs24h: 41,
    successRate: 0.62,
    // Coût non mesurable : le cas qui doit rendre « Non mesuré », pas « $0.00 ».
    costUsd: null,
    runBlockers: [
      '2 outils non résolus — la garde refuserait un lancement.',
      'Assistant LangGraph non provisionné : le run tournerait contre le graphe nu.',
    ],
  },
  {
    id: 'fixture-sentinel',
    initials: 'SM',
    name: 'Sentinel marché',
    project: 'Trading',
    status: 'inactive',
    // Zéro run mesuré : le taux de succès n'existe pas, il ne vaut pas 0 %.
    runs24h: 0,
    successRate: null,
    costUsd: null,
    runBlockers: [],
  },
  {
    id: 'fixture-reviewer',
    initials: 'RC',
    name: 'Relecteur de contrats',
    project: 'Legal',
    status: 'active',
    runs24h: 17,
    successRate: 1,
    costUsd: 0.83,
    runBlockers: [],
  },
] as const

/**
 * La grappe du pattern « dossier ». Les quatre premiers sont ceux qu'on voit
 * sur la vignette fermée et qui MORPHENT à l'ouverture ; les suivants n'ont pas
 * d'équivalent visible et jaillissent du centre.
 */
export const LAB_CLUSTER: readonly { id: string; initials: string; name: string; shared: boolean }[] = [
  { id: 'c-architect', initials: 'AM', name: 'Architecte', shared: true },
  { id: 'c-pricer', initials: 'PD', name: 'Pricer', shared: true },
  { id: 'c-sentinel', initials: 'SM', name: 'Sentinel', shared: true },
  { id: 'c-reviewer', initials: 'RC', name: 'Relecteur', shared: true },
  { id: 'c-indexer', initials: 'IX', name: 'Indexeur', shared: false },
  { id: 'c-router', initials: 'RT', name: 'Routeur', shared: false },
  { id: 'c-auditor', initials: 'AU', name: 'Auditeur', shared: false },
  { id: 'c-notifier', initials: 'NT', name: 'Notifieur', shared: false },
] as const
