/**
 * File opérateur — la file d'action COMPLÈTE de `/actions`.
 *
 * POURQUOI CE MODULE EXISTE, ET CE QU'IL NE REFAIT PAS
 * ---------------------------------------------------
 * `dashboard-overview.ts` dérive déjà une file d'action (`buildActionItems`)
 * avec sept `ActionItemKind`, une priorité déterministe (`ACTION_PRIORITY`) et
 * un `href` par ligne. Cette file est TRONQUÉE à six lignes pour l'aperçu — le
 * paramètre `limit`. `navigation.ts` décrit d'ailleurs `/actions` comme « la
 * colonne de l'aperçu, sans troncature ».
 *
 * Ce module ne réécrit donc PAS cette dérivation : il la RÉUTILISE telle
 * quelle et l'ÉTEND avec les deux catégories que l'aperçu ne porte pas, parce
 * qu'elles ne sont pas dans son périmètre de lecture :
 *
 *  · les runs `needs-confirmation` — un run LangGraph mis en pause sur un
 *    interrupt d'approbation. C'est la SEULE catégorie de cette file qui
 *    possède une mutation réellement sûre (voir « Mutation » ci-dessous).
 *  · les décisions d'amélioration ouvertes — une `ImprovementProposal` en
 *    statut `proposed` ou `v2-created` attend un arbitrage humain.
 *
 * Écrire une seconde file concurrente aurait créé le « deuxième registre » que
 * la mission interdit explicitement, et surtout une file qui DÉRIVE : deux
 * dérivations de la même vérité divergent au premier changement de règle. La
 * priorité reste celle de `ACTION_PRIORITY`, source unique.
 *
 * MUTATION — LA DISTINCTION QUI GOUVERNE CET ÉCRAN
 * ------------------------------------------------
 * La mission interdit tout bouton factice et tout nouveau mécanisme
 * d'exécution. Chaque ligne porte donc un `mutation` explicite :
 *
 *  · `{ kind: 'resume-run', … }` — SEULE mutation câblée ici. La route
 *    `POST /api/agent-ops/copilots/:id/runs/:runId/resume` existe, elle est
 *    fail-closed et elle réclame le compare-and-swap atomique sur
 *    `status=eq.needs-confirmation` : deux reprises concurrentes ne peuvent pas
 *    passer, la perdante prend un 409 propre AVANT tout effet de bord. Elle
 *    refuse aussi de mentir sur l'issue (un outil approuvé qui échoue devient
 *    `failed`, jamais `completed`). C'est ce qui en fait un contrat de
 *    confirmation SÛR au sens de la mission.
 *  · `null` — aucune mutation sûre connue pour cette ligne. L'UI n'affiche
 *    alors QUE « Ouvrir le contexte » vers le `href` canonique. Pas de bouton
 *    grisé, pas de bouton qui ne fait rien : l'absence de mutation est un fait
 *    affiché, pas une capacité suggérée.
 *
 * Les décisions d'amélioration ont bien une route (`improve/decision`), mais
 * elle exige un `proposalId` ET un arbitrage éditorial (approuver quoi, sur la
 * base de quelle analyse) qui ne tient pas dans un bouton de file. Elles
 * restent donc en lecture avec « Ouvrir le contexte » — c'est exactement le cas
 * n°8 de la validation (« action sans mutation sûre »).
 *
 * VÉRITÉ DES DONNÉES
 * ------------------
 * Le contrat à trois états de `dashboard-overview.ts` est repris à
 * l'identique : `[]` = lecture réussie et rien à faire (file vide MESURÉE),
 * `[...]` = lignes réelles, `null` = lecture ÉCHOUÉE. Une source en échec
 * devient une LIGNE de la file (`data_unavailable`) et non un silence : un
 * opérateur qui voit une file calme doit pouvoir distinguer « rien à traiter »
 * de « je n'ai pas pu regarder ».
 */
import type { AgentRun, Copilot, Project } from './types'
import type { ActionItem, ActionItemKind } from './dashboard-overview'

/**
 * Mutation réellement disponible sur une ligne de file.
 *
 * Union fermée : ajouter une mutation exige d'ajouter son variant ici, donc de
 * nommer la route et sa politique de confirmation. On ne peut pas câbler un
 * bouton « par accident ».
 */
export type QueueMutation = {
  kind: 'resume-run'
  /** Route mutante réelle, déjà existante et fail-closed. */
  endpoint: string
  copilotId: string
  runId: string
  /**
   * Vrai quand l'action exige une double confirmation côté UI. Une reprise
   * approuve l'exécution d'un outil que le manifeste a marqué comme exigeant
   * une signature humaine : c'est gouverné comme dangereux, donc confirmé deux
   * fois (mission §2).
   */
  requiresDoubleConfirmation: boolean
}

/** Les catégories propres à la file complète, en plus des sept de l'aperçu. */
export type OperatorQueueKind = ActionItemKind | 'run_needs_confirmation' | 'improvement_decision'

/**
 * Priorité des deux catégories ajoutées.
 *
 * `run_needs_confirmation` passe AVANT tout le reste (-1) : un run en pause
 * bloque une exécution en vol et c'est la seule ligne réellement actionnable
 * d'un clic. `improvement_decision` se pose entre `release_gate_red` (3) et
 * `pr_open` (4) — un arbitrage V2 est plus urgent qu'une PR ouverte, moins
 * qu'une gate rouge. Les sept autres gardent EXACTEMENT la priorité de
 * `ACTION_PRIORITY` : ce module n'a pas autorité pour les réordonner.
 */
const ADDED_PRIORITY = {
  run_needs_confirmation: -1,
  improvement_decision: 3.5,
} as const satisfies Record<'run_needs_confirmation' | 'improvement_decision', number>

export type OperatorQueueItem = {
  id: string
  kind: OperatorQueueKind
  title: string
  meta: string
  status: string
  /** Contexte canonique — toujours une route ou une URL réelle, jamais `'#'`. */
  href: string
  /** Libellé du lien de contexte (jamais celui d'une mutation). */
  buttonLabel: string
  priority: number
  /** `null` = aucune mutation sûre : lecture seule, « Ouvrir le contexte ». */
  mutation: QueueMutation | null
  /** Agent concerné quand la ligne en porte un — sert au filtre par agent. */
  copilotId: string | null
  /** Projet concerné quand la ligne en porte un — sert au filtre par projet. */
  projectId: string | null
  /**
   * Niveau de risque, UNIQUEMENT quand il est prouvable (mission §2 : « niveau
   * de risque quand prouvable »). `null` par défaut : on n'invente pas une
   * échelle de risque pour remplir une colonne.
   */
  risk: 'high' | 'medium' | null
}

/**
 * Une source lue, avec son issue explicite.
 *
 * `null` ne veut pas dire « vide » : il veut dire « pas lu ». C'est ce qui
 * permet à la file de distinguer les deux dans son rendu.
 */
export type QueueSourceState = {
  /** Identifiant lisible de la source, pour attribuer une panne. */
  source: string
  ok: boolean
  /** Motif quand `ok` est faux — attribué, jamais générique. */
  detail: string | null
}

/**
 * Les noms lisibles des identifiants présents dans la file.
 *
 * Un menu déroulant qui propose « copilot-market-intelligence » ne renseigne
 * personne. La jointure id → nom est faite ICI, côté serveur, à partir des
 * lectures déjà effectuées — pas de second aller-retour, et surtout pas de
 * re-parsing du libellé `meta` côté client.
 *
 * Un identifiant absent de ces tables reste affiché TEL QUEL par l'UI : un id
 * non résolu est un id non résolu, on n'invente pas un nom.
 */
export type QueueLabels = {
  copilots: Record<string, string>
  projects: Record<string, string>
}

export type OperatorQueue = {
  items: OperatorQueueItem[]
  /** État de CHAQUE source composée — l'UI affiche les pannes nommément. */
  sources: QueueSourceState[]
  /** Noms lisibles pour les filtres — voir `QueueLabels`. */
  labels: QueueLabels
  /** Avertissements hérités de l'aperçu, repris tels quels. */
  dataWarnings: string[]
  /**
   * Instant de composition (ISO). La fraîcheur est affichée : une file sans
   * horodatage laisse croire qu'elle est temps réel.
   */
  composedAt: string
}

/**
 * Une proposition d'amélioration en attente d'arbitrage, réduite à ce que la
 * file a besoin d'afficher. Volontairement PAS le type complet
 * `ImprovementProposal` : la file n'a aucun usage de `failureAnalysis` ni de
 * `manifestChanges`, et les transporter dans un composant client exposerait de
 * l'analyse brute sans raison.
 */
export type OpenImprovementDecision = {
  proposalId: string
  copilotId: string
  status: 'proposed' | 'v2-created'
  summary: string
  createdAt: string
}

/**
 * Un run en attente d'approbation humaine, réduit de même.
 */
export type PendingRunConfirmation = {
  runId: string
  copilotId: string
  /** Résumé déjà borné par le runner — jamais le payload d'outil complet. */
  outputSummary: string | null
  startedAt: string | null
}

/** Les runs de la fenêtre qui sont réellement en attente d'une signature. */
export function selectPendingConfirmations(runs: AgentRun[]): PendingRunConfirmation[] {
  return runs
    .filter((run) => run.status === 'needs-confirmation')
    .map((run) => ({
      runId: run.id,
      copilotId: run.copilotId,
      outputSummary: run.outputSummary ?? null,
      startedAt: run.startedAt ?? null,
    }))
}

/** Les propositions qui attendent encore une décision humaine. */
export function selectOpenDecisions(
  proposals: readonly { id: string; copilotId: string; status: string; summary: string; createdAt: string }[]
): OpenImprovementDecision[] {
  const open: OpenImprovementDecision[] = []
  for (const proposal of proposals) {
    if (proposal.status !== 'proposed' && proposal.status !== 'v2-created') continue
    open.push({
      proposalId: proposal.id,
      copilotId: proposal.copilotId,
      status: proposal.status,
      summary: proposal.summary,
      createdAt: proposal.createdAt,
    })
  }
  return open
}

/** Le nom d'un copilot, ou son id si la jointure n'a rien donné. On n'invente
 *  pas un nom : un id non résolu reste un id, visible comme tel. */
function copilotLabel(copilotId: string, copilotsById: Map<string, Copilot>): string {
  return copilotsById.get(copilotId)?.name ?? copilotId
}

/**
 * Compose la file complète — PURE, donc testable sans backend.
 *
 * `actionItems` arrive déjà trié et dérivé par `buildActionItems` ; on ne le
 * re-dérive pas, on le transpose (chaque item hérite `mutation: null`, aucune
 * des sept catégories de l'aperçu n'ayant de mutation sûre en un clic) puis on
 * fusionne les deux catégories ajoutées et on retrie sur la priorité unifiée.
 */
export function buildOperatorQueue(input: {
  actionItems: readonly ActionItem[]
  /** `null` = la lecture des runs a échoué (contrat trois états). */
  pendingConfirmations: PendingRunConfirmation[] | null
  /** `null` = la lecture des propositions a échoué. */
  openDecisions: OpenImprovementDecision[] | null
  copilotsById: Map<string, Copilot>
  projectsById: Map<string, Project>
  dataWarnings: readonly string[]
  composedAt: string
}): OperatorQueue {
  const items: OperatorQueueItem[] = []
  const sources: QueueSourceState[] = []

  // Les sept catégories de l'aperçu, transposées sans altération de leur
  // priorité ni de leur href canonique.
  //
  // `copilotId` / `projectId` sont REPRIS de l'item amont, pas remis à `null`.
  // Ils y étaient écrasés au départ, ce qui rendait les filtres par agent et
  // par projet aveugles à sept catégories sur neuf : la file affichait un
  // filtre « agent » qui ne voyait que les runs en attente.
  for (const item of input.actionItems) {
    items.push({
      id: item.id,
      kind: item.kind,
      title: item.title,
      meta: item.meta,
      status: item.status,
      href: item.href,
      buttonLabel: item.buttonLabel,
      priority: item.priority,
      mutation: null,
      copilotId: item.copilotId,
      // Le projet peut manquer sur l'item amont alors que le copilot le
      // connaît (une ligne de livraison porte son copilot, pas son projet) :
      // on complète par la jointure en mémoire déjà disponible ici, sans
      // aller-retour supplémentaire.
      projectId: item.projectId ?? (item.copilotId ? input.copilotsById.get(item.copilotId)?.projectId ?? null : null),
      // Une gate rouge et une sandbox en échec bloquent une livraison : c'est
      // un risque PROUVÉ par la dérivation amont, pas une estimation.
      risk: item.kind === 'release_gate_red' || item.kind === 'sandbox_failed' ? 'high' : null,
    })
  }

  if (input.pendingConfirmations === null) {
    sources.push({
      source: 'runs',
      ok: false,
      detail: "La fenêtre de runs n'a pas pu être lue : les approbations en attente ne sont pas représentées.",
    })
    items.push({
      id: 'queue_unavailable_runs',
      kind: 'data_unavailable',
      title: 'Runs en attente non lus',
      meta: 'Les approbations humaines ne sont pas représentées dans cette file.',
      status: 'unavailable',
      href: '/runs',
      buttonLabel: 'Ouvrir les runs',
      priority: ADDED_PRIORITY.run_needs_confirmation,
      mutation: null,
      copilotId: null,
      projectId: null,
      risk: null,
    })
  } else {
    sources.push({ source: 'runs', ok: true, detail: null })
    for (const pending of input.pendingConfirmations) {
      const copilot = input.copilotsById.get(pending.copilotId)
      items.push({
        id: `queue_confirm_${pending.runId}`,
        kind: 'run_needs_confirmation',
        title: 'Run en attente de confirmation',
        meta: `${copilotLabel(pending.copilotId, input.copilotsById)} · run ${pending.runId.slice(0, 8)}`,
        status: 'needs-confirmation',
        href: `/agents/${pending.copilotId}`,
        buttonLabel: "Ouvrir l'agent",
        priority: ADDED_PRIORITY.run_needs_confirmation,
        mutation: {
          kind: 'resume-run',
          endpoint: `/api/agent-ops/copilots/${pending.copilotId}/runs/${pending.runId}/resume`,
          copilotId: pending.copilotId,
          runId: pending.runId,
          // Reprendre, c'est autoriser l'outil que le manifeste a jugé digne
          // d'une signature humaine. Gouverné comme dangereux → double
          // confirmation.
          requiresDoubleConfirmation: true,
        },
        copilotId: pending.copilotId,
        projectId: copilot?.projectId ?? null,
        risk: 'high',
      })
    }
  }

  if (input.openDecisions === null) {
    sources.push({
      source: 'improvement-proposals',
      ok: false,
      detail: "Les propositions d'amélioration n'ont pas pu être lues : les arbitrages V2 ouverts sont absents de cette file.",
    })
    items.push({
      id: 'queue_unavailable_decisions',
      kind: 'data_unavailable',
      title: "Décisions d'amélioration non lues",
      meta: 'Les arbitrages V2 ouverts ne sont pas représentés dans cette file.',
      status: 'unavailable',
      href: '/agents',
      buttonLabel: 'Ouvrir les agents',
      priority: ADDED_PRIORITY.improvement_decision,
      mutation: null,
      copilotId: null,
      projectId: null,
      risk: null,
    })
  } else {
    sources.push({ source: 'improvement-proposals', ok: true, detail: null })
    for (const decision of input.openDecisions) {
      const copilot = input.copilotsById.get(decision.copilotId)
      items.push({
        id: `queue_decision_${decision.proposalId}`,
        kind: 'improvement_decision',
        title:
          decision.status === 'v2-created'
            ? 'V2 créée — arbitrage en attente'
            : "Proposition d'amélioration à arbitrer",
        meta: `${copilotLabel(decision.copilotId, input.copilotsById)} · ${decision.summary.slice(0, 80)}`,
        status: decision.status,
        href: `/agents/${decision.copilotId}`,
        buttonLabel: "Ouvrir le contexte",
        priority: ADDED_PRIORITY.improvement_decision,
        // Lecture seule : la route existe mais l'arbitrage ne tient pas dans un
        // bouton de file (voir l'en-tête du module).
        mutation: null,
        copilotId: decision.copilotId,
        projectId: copilot?.projectId ?? null,
        risk: null,
      })
    }
  }

  // Noms lisibles des SEULS identifiants réellement présents dans la file —
  // pas du roster entier : une table qui décrit des agents absents de l'écran
  // grossit la charge utile sans servir un seul filtre.
  const labels: QueueLabels = { copilots: {}, projects: {} }
  for (const item of items) {
    if (item.copilotId && !labels.copilots[item.copilotId]) {
      const name = input.copilotsById.get(item.copilotId)?.name
      if (name) labels.copilots[item.copilotId] = name
    }
    if (item.projectId && !labels.projects[item.projectId]) {
      const name = input.projectsById.get(item.projectId)?.name
      if (name) labels.projects[item.projectId] = name
    }
  }

  return {
    // Tri stable : à priorité égale l'ordre d'insertion est conservé, donc
    // l'ordre déterministe des sources amont. `toSorted` ne mute pas l'entrée.
    items: items.toSorted((a, b) => a.priority - b.priority),
    sources,
    labels,
    dataWarnings: [...input.dataWarnings],
    composedAt: input.composedAt,
  }
}

/**
 * Les valeurs de filtre offertes par l'écran — DÉRIVÉES des lignes réelles,
 * jamais codées en dur.
 *
 * RÈGLE : un filtre ne s'affiche que s'il DISCRIMINE, c'est-à-dire s'il offre
 * au moins deux valeurs distinctes. Un sélecteur « agent » sur une file qui ne
 * contient qu'un seul agent n'est pas une commande, c'est une décoration qui
 * suggère un tri impossible — et il ment sur la variété des données.
 */
export type QueueFilters = {
  kinds: OperatorQueueKind[]
  copilotIds: string[]
  projectIds: string[]
  /** Les statuts réellement présents. Ce ne sont PAS les `kind` : une même
   *  catégorie porte plusieurs statuts (`proposed` / `v2-created` pour une
   *  décision V2), et deux catégories peuvent partager un statut. */
  statuses: string[]
  /** Vrai si au moins une ligne porte un risque prouvé — sinon le filtre risque
   *  n'a pas lieu d'être affiché. */
  hasRisk: boolean
  /** Vrai si au moins une ligne est réellement actionnable. */
  hasMutation: boolean
}

export function deriveQueueFilters(items: readonly OperatorQueueItem[]): QueueFilters {
  const kinds = new Set<OperatorQueueKind>()
  const copilotIds = new Set<string>()
  const projectIds = new Set<string>()
  const statuses = new Set<string>()
  let hasRisk = false
  let hasMutation = false

  for (const item of items) {
    kinds.add(item.kind)
    if (item.copilotId) copilotIds.add(item.copilotId)
    if (item.projectId) projectIds.add(item.projectId)
    if (item.status) statuses.add(item.status)
    if (item.risk !== null) hasRisk = true
    if (item.mutation !== null) hasMutation = true
  }

  return {
    // Tri déterministe : deux rendus de la même file offrent les mêmes filtres
    // dans le même ordre, sinon les boutons dansent d'un chargement à l'autre.
    kinds: [...kinds],
    copilotIds: [...copilotIds].toSorted(),
    projectIds: [...projectIds].toSorted(),
    statuses: [...statuses].toSorted(),
    hasRisk,
    hasMutation,
  }
}

/**
 * Un critère est-il DISCRIMINANT ? Deux valeurs distinctes minimum.
 *
 * Sur une file à un seul agent, filtrer par agent ne retire jamais rien : le
 * contrôle serait inerte. L'UI s'en sert pour ne rendre que les filtres qui
 * peuvent réellement changer l'affichage.
 */
export function isDiscriminating(values: readonly string[]): boolean {
  return values.length > 1
}

/** Applique une sélection de filtres. Un critère absent ne filtre rien. */
export function filterQueue(
  items: readonly OperatorQueueItem[],
  selection: Readonly<{
    kind?: OperatorQueueKind | null
    copilotId?: string | null
    projectId?: string | null
    status?: string | null
    riskOnly?: boolean
    actionableOnly?: boolean
  }>
): OperatorQueueItem[] {
  return items.filter((item) => {
    if (selection.kind && item.kind !== selection.kind) return false
    if (selection.copilotId && item.copilotId !== selection.copilotId) return false
    if (selection.projectId && item.projectId !== selection.projectId) return false
    if (selection.status && item.status !== selection.status) return false
    if (selection.riskOnly && item.risk === null) return false
    if (selection.actionableOnly && item.mutation === null) return false
    return true
  })
}

/** Libellés français des catégories — l'UI ne fabrique pas les siens. */
export const QUEUE_KIND_LABEL: Record<OperatorQueueKind, string> = {
  run_needs_confirmation: 'Confirmation de run',
  architect_approval: 'Approbation architecte',
  ready_manual: 'Test manuel',
  sandbox_failed: 'Sandbox en échec',
  release_gate_red: 'Release gate rouge',
  improvement_decision: 'Décision V2',
  pr_open: 'PR ouverte',
  mission_blocked: 'Mission bloquée',
  data_unavailable: 'Source indisponible',
}
