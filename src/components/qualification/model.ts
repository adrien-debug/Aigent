/**
 * Dérivations PURES de la surface Qualification — aucune I/O, aucun React.
 *
 * Ce module traduit les contrats serveur (`ReleaseGate`, `PromotionGateResult`,
 * `QualificationRun`, `ImprovementProposal`) en ce que l'écran montre, et il est
 * séparé des composants pour la raison habituelle : ces règles se testent sans
 * DOM ni backend, et ce sont elles qui portent les vérités que l'UI ne doit PAS
 * réinventer.
 *
 * CE QUE CE MODULE TIENT
 * ----------------------
 * 1. **Un `missing` n'est pas un `pass`.** La gate de release a trois états et
 *    l'écran en rend trois. Depuis le correctif F1, un compteur de sécurité non
 *    mesuré rend `null` → check `'missing'` : le confondre avec un succès est
 *    exactement ce qui promeut une version non prouvée.
 * 2. **Une liste de checks VIDE n'est pas promouvable.** `[].every(pred)` vaut
 *    `true` en JavaScript : une agrégation naïve déclarerait « tout passe » sur
 *    zéro preuve. `summarizeChecks` exige `total > 0`.
 * 3. **La garde d'exécution ne se recalcule PAS ici.** `AvailableAgent.status`,
 *    `.executable`, `.unresolvedToolIds` et `.runtime` viennent de
 *    `getAvailableAgent`, la même dérivation que la route de run. Ce module ne
 *    fait que NOMMER les trois conditions pour les rendre lisibles ; il ne
 *    décide jamais à leur place.
 * 4. **Le replay sans baseline n'est pas un replay échoué.** Sans
 *    `production_version_id`, la route répond 409 « pas de version de production
 *    à comparer » : c'est une dépendance circulaire structurelle, dite comme
 *    telle et jamais comme une panne.
 */
import type { AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import type { GateStatus, ReleaseCheck } from '@/lib/agent-mission-control/release-gate'
import type {
  PromotionCheck,
  PromotionCheckStatus,
} from '@/lib/agent-mission-control/promotion-gate'
import type {
  QualificationRunStatus,
  QualificationStep,
  QualificationStepStatus,
} from '@/lib/agent-mission-control/qualification-orchestrator'
import type { ImprovementProposal } from '@/lib/agent-mission-control/improvement-loop'

/* ───────────────────── Gate de release — trois états ───────────────────── */

export const GATE_STATUS_LABEL: Record<GateStatus, string> = {
  pass: 'Vérifié',
  fail: 'Échoué',
  missing: 'Non mesuré',
}

/**
 * Ce que chaque état AFFIRME. Rendu en `title` pour que la distinction ne repose
 * jamais uniquement sur une couleur — un écran lu en niveaux de gris doit rester
 * vrai.
 */
export const GATE_STATUS_MEANING: Record<GateStatus, string> = {
  pass: 'La mesure a été prise sur des runs live et elle satisfait l’exigence.',
  fail: 'La mesure a été prise et elle viole l’exigence.',
  missing:
    'La mesure n’a JAMAIS été prise. Ce n’est pas un succès : un signal absent bloque la promotion au même titre qu’un échec, mais il n’accuse rien — il constate qu’il n’y a rien à lire.',
}

export interface ChecksSummary {
  total: number
  passed: number
  failed: number
  /** Checks dont le signal n'a jamais été mesuré — ils bloquent aussi. */
  missing: number
  /**
   * Vrai UNIQUEMENT si la liste n'est pas vide ET que tous les checks passent.
   *
   * Le `total > 0` est la protection contre `[].every()`, qui vaut `true` : sans
   * lui, une gate dont aucun check n'a pu être évalué s'afficherait
   * « promouvable » — un feu vert posé sur zéro preuve.
   */
  promotable: boolean
  /** Nombre d'obstacles réels (échec + non mesuré) — le chiffre utile. */
  blocking: number
}

export function summarizeChecks(checks: readonly ReleaseCheck[]): ChecksSummary {
  const passed = checks.filter((c) => c.status === 'pass').length
  const failed = checks.filter((c) => c.status === 'fail').length
  const missing = checks.filter((c) => c.status === 'missing').length
  return {
    total: checks.length,
    passed,
    failed,
    missing,
    promotable: checks.length > 0 && passed === checks.length,
    blocking: failed + missing,
  }
}

/** Ce qui bloque en premier ; `fail` (fait établi) avant `missing` (trou). */
const GATE_RANK: Record<GateStatus, number> = { fail: 0, missing: 1, pass: 2 }

export function sortReleaseChecks(checks: readonly ReleaseCheck[]): ReleaseCheck[] {
  return [...checks].sort((a, b) => GATE_RANK[a.status] - GATE_RANK[b.status])
}

/* ─────────────────── Gate de promotion — quatre états ─────────────────── */

export const PROMOTION_STATUS_LABEL: Record<PromotionCheckStatus, string> = {
  PASS: 'Vérifié',
  FAIL: 'Échoué',
  NOT_CONFIGURED: 'Non exigé',
  INSUFFICIENT_EVIDENCE: 'Preuve insuffisante',
}

export const PROMOTION_STATUS_MEANING: Record<PromotionCheckStatus, string> = {
  PASS: 'La preuve existe et satisfait l’exigence.',
  FAIL: 'La preuve existe et viole l’exigence.',
  NOT_CONFIGURED:
    'La politique de promotion de ce copilot n’exige pas cette preuve. Ce n’est ni un succès ni un échec : le check n’est simplement pas requis ici.',
  INSUFFICIENT_EVIDENCE:
    'La preuve est absente ou trop faible pour trancher. Elle bloque la promotion sans rien affirmer contre le candidat.',
}

const PROMOTION_RANK: Record<PromotionCheckStatus, number> = {
  FAIL: 0,
  INSUFFICIENT_EVIDENCE: 1,
  NOT_CONFIGURED: 2,
  PASS: 3,
}

export function sortPromotionChecks(checks: readonly PromotionCheck[]): PromotionCheck[] {
  return [...checks].sort((a, b) => PROMOTION_RANK[a.status] - PROMOTION_RANK[b.status])
}

/* ──────────────── Étapes de qualification — six états ──────────────── */

export const STEP_LABEL: Record<QualificationStep, string> = {
  tests: 'Tests',
  benchmark: 'Benchmark',
  shadow: 'Shadow',
  replay: 'Replay',
  gate: 'Gate de promotion',
}

export const STEP_STATUS_LABEL: Record<QualificationStepStatus, string> = {
  PASS: 'Vérifié',
  FAIL: 'Échoué',
  NOT_CONFIGURED: 'Non exigé',
  NOT_AVAILABLE: 'Capacité non câblée',
  INSUFFICIENT_EVIDENCE: 'Preuve insuffisante',
  PENDING: 'Pas encore exécuté',
}

export const STEP_STATUS_MEANING: Record<QualificationStepStatus, string> = {
  PASS: 'L’étape a produit une preuve qui satisfait son exigence.',
  FAIL: 'L’étape a produit une preuve qui viole son exigence.',
  NOT_CONFIGURED: 'La politique de ce candidat n’exige pas cette étape.',
  NOT_AVAILABLE:
    'La capacité n’est pas câblée dans ce périmètre — l’étape n’a rien pu produire. Ce n’est pas un échec du candidat.',
  INSUFFICIENT_EVIDENCE:
    'L’étape a tourné sans réunir assez de preuve pour trancher. Elle bloque sans accuser.',
  PENDING: 'L’étape n’a pas encore été exécutée.',
}

export const RUN_STATUS_LABEL: Record<QualificationRunStatus, string> = {
  running: 'En cours',
  blocked: 'Bloquée',
  promotable: 'Promouvable',
  superseded: 'Dépassée',
  aborted: 'Interrompue',
}

export const RUN_STATUS_MEANING: Record<QualificationRunStatus, string> = {
  running: 'Le parcours avance encore — le curseur indique l’étape suivante.',
  blocked:
    'La gate a tranché : au moins un check ne passe pas. Corriger, puis relancer une qualification.',
  promotable:
    'Tous les checks de la gate passent. « Promouvable » est un ÉTAT, jamais un acte : rien n’est promu automatiquement.',
  superseded:
    'Le manifeste, les outils ou le modèle du candidat ont changé pendant le parcours — la preuve accumulée ne porte plus sur le même candidat.',
  aborted:
    'Le candidat n’est plus une version draft/beta (archivée ou promue en cours de route). Repartir d’un brouillon frais.',
}

/* ─────────────── Garde d'exécution — les TROIS conditions ─────────────── */

/**
 * Une condition de la garde `POST /copilots/:id/run`, telle qu'elle est écrite
 * dans la route — jamais recalculée, seulement NOMMÉE.
 */
export interface RunGuardCondition {
  id: 'status-active' | 'tools-resolved' | 'runtime-langgraph'
  label: string
  /** L'état observé, tel que le contrat canonique le rend. */
  observed: string
  satisfied: boolean
  detail: string
}

/**
 * Les trois conditions de la garde d'exécution, lues depuis `AvailableAgent`.
 *
 * L'agent EST le contrat canonique (`getAvailableAgent`) : `status`,
 * `unresolvedToolIds` et `runtime` sont recopiés tels quels. `agent === null`
 * signifie qu'aucune ligne canonique ne résout — dans ce cas les trois
 * conditions sont INCONNUES, pas fausses, et l'appelant doit le dire.
 */
export function runGuardConditions(agent: AvailableAgent): RunGuardCondition[] {
  const unresolved = agent.unresolvedToolIds.length
  return [
    {
      id: 'status-active',
      label: 'Statut runtime « active »',
      observed: agent.status,
      satisfied: agent.status === 'active',
      detail:
        '« active » signifie PROUVÉ : chemin d’exécution complet et version en service. Le statut vient de getAvailableAgent — l’écran ne le recalcule jamais.',
    },
    {
      id: 'tools-resolved',
      label: 'Aucun outil non résolu',
      observed: unresolved === 0 ? 'tous les outils résolvent' : `${unresolved} non résolu(s)`,
      satisfied: unresolved === 0,
      detail:
        'Un outil est résolu seulement si une ligne `tools` existe ET que le runner porte un handler sous ce nom. Un outil déclaré sans handler rend l’agent dégradé.',
    },
    {
      id: 'runtime-langgraph',
      label: 'Runtime « langgraph »',
      observed: agent.runtime ?? 'runtime non résolu',
      satisfied: agent.runtime === 'langgraph',
      detail:
        'LangGraph est le seul runtime produit exécutable. Un autre runtime — ou une colonne vide — fait refuser le lancement avec un 409.',
    },
  ]
}

/**
 * `true` seulement si les TROIS conditions tiennent.
 *
 * Ce booléen ne remplace pas `agent.executable` : il le REJOUE à partir des
 * champs nommés, pour que l'écran puisse expliquer POURQUOI. Les deux doivent
 * coïncider ; s'ils divergeaient, c'est le contrat canonique qui a raison, et
 * `runGuardDivergence` le signale plutôt que de le taire.
 */
export function runGuardWouldAccept(conditions: readonly RunGuardCondition[]): boolean {
  return conditions.length === 3 && conditions.every((c) => c.satisfied)
}

/**
 * Divergence entre la garde rejouée et le champ canonique `executable`.
 *
 * Renvoie `null` quand tout concorde. Un écart n'est jamais résolu en silence en
 * faveur de l'affichage : il est affiché, parce qu'il signale que la dérivation
 * canonique a changé sans que cet écran le sache.
 */
export function runGuardDivergence(
  agent: AvailableAgent,
  conditions: readonly RunGuardCondition[],
): string | null {
  const replayed = runGuardWouldAccept(conditions)
  if (replayed === agent.executable) return null
  return `Le contrat canonique dit « ${agent.executable ? 'lançable' : 'non lançable'} » alors que les trois conditions rejouées disent « ${replayed ? 'lançable' : 'non lançable'} ». C’est le contrat canonique qui fait foi — cet écart doit être corrigé côté dérivation.`
}

/* ─────────────────── Boucle d'amélioration ─────────────────── */

export const PROPOSAL_STATUS_LABEL: Record<ImprovementProposal['status'], string> = {
  proposed: 'Proposée',
  'v2-created': 'V2 créée',
  approved: 'Approuvée',
  rejected: 'Rejetée',
}

/**
 * Une boucle est OUVERTE tant qu'elle n'a pas reçu sa décision humaine.
 *
 * C'est l'état que la base garantit à une seule instance par copilot (409 sur
 * `improve/analyze`). Une boucle ouverte n'est pas une erreur : c'est
 * l'information « quelqu'un doit décider », et l'UI la rend comme telle.
 */
export function isProposalOpen(proposal: ImprovementProposal | null): boolean {
  if (!proposal) return false
  return proposal.status === 'proposed' || proposal.status === 'v2-created'
}

/**
 * Ce que la boucle attend maintenant. Rendu en une phrase, jamais en un mot :
 * « proposed » ne dit pas à l'opérateur qu'il doit d'abord matérialiser la V2.
 */
export function proposalNextAction(proposal: ImprovementProposal | null): string {
  if (!proposal) {
    return 'Aucune boucle d’amélioration n’existe pour ce copilot. La lecture a réussi — il n’y a rien.'
  }
  switch (proposal.status) {
    case 'proposed':
      return 'La proposition attend sa V2 : matérialiser le brouillon V2, puis décider. Une approbation sans V2 est refusée (409).'
    case 'v2-created':
      return 'La V2 existe. La DÉCISION HUMAINE est ce qui manque — approuver ou rejeter, explicitement.'
    case 'approved':
      return 'Boucle approuvée. L’approbation n’a rien promu : la promotion reste une action séparée, derrière sa propre gate.'
    case 'rejected':
      return 'Boucle rejetée. Une nouvelle analyse peut être ouverte.'
  }
}

/* ─────────────────── Replay — dépendance circulaire ─────────────────── */

export type ReplayFeasibility = 'possible' | 'no-baseline' | 'unknown'

/**
 * Le replay peut-il seulement TOURNER ?
 *
 * Il compare le candidat à la version de PRODUCTION. Sans
 * `production_version_id`, la route répond 409 avant toute exécution : ce n'est
 * pas un replay qui a échoué, c'est un replay qui n'a rien à comparer. La
 * distinction est structurelle et l'écran la porte telle quelle.
 *
 * `unknown` couvre le cas où le pointeur de production n'a pas pu être lu — une
 * lecture absente n'est pas une absence de baseline.
 */
export function replayFeasibility(
  productionVersionId: string | null,
  productionRead: boolean,
): ReplayFeasibility {
  if (!productionRead) return 'unknown'
  return productionVersionId ? 'possible' : 'no-baseline'
}

export const REPLAY_FEASIBILITY_DETAIL: Record<ReplayFeasibility, string> = {
  possible:
    'Une version de production existe : elle sert de référence, le candidat lui est comparé cas par cas.',
  'no-baseline':
    'Aucune version de production n’existe pour ce copilot, donc le replay n’a RIEN à comparer et la route refuse de partir (409). Ce n’est pas « replay échoué » : c’est une dépendance circulaire — il faut une première promotion pour créer la baseline que le replay exigerait.',
  unknown:
    'Le pointeur de production n’a pas pu être lu. Impossible de dire si un replay serait possible — ce n’est pas la même chose qu’une absence de baseline.',
}

/* ─────────────────── Mode d'exécution d'une preuve ─────────────────── */

export type EvidenceExecutionMode = 'live_langgraph' | 'deterministic_fixture' | 'legacy_unknown'

export const EXECUTION_MODE_LABEL: Record<EvidenceExecutionMode, string> = {
  live_langgraph: 'exécution live',
  deterministic_fixture: 'simulation (fixture)',
  legacy_unknown: 'provenance inconnue',
}

export const EXECUTION_MODE_DETAIL: Record<EvidenceExecutionMode, string> = {
  live_langgraph:
    'Preuve produite par un vrai run LangGraph du candidat. C’est le SEUL mode qu’une gate de promotion accepte pour un check exigé.',
  deterministic_fixture:
    'Preuve produite par la fixture déterministe, à coût nul et sans réseau. Elle prouve la mécanique, jamais le candidat : une fixture ne débloque aucune promotion de production.',
  legacy_unknown:
    'Ligne antérieure aux migrations de provenance : le mode d’exécution n’a pas été enregistré. Non prouvé n’est pas faux, mais une gate exigeante ne s’en satisfait pas.',
}

export function executionMode(raw: unknown): EvidenceExecutionMode {
  return raw === 'live_langgraph' || raw === 'deterministic_fixture' ? raw : 'legacy_unknown'
}

/* ─────────────────── Tri des candidats ─────────────────── */

/**
 * Ordre du roster de qualification : ce qui attend une DÉCISION en premier.
 *
 * Un candidat promouvable attend un humain — c'est le seul état que rien
 * n'avance sans geste. Vient ensuite ce qui est bloqué (il y a du travail),
 * puis ce qui tourne, puis le reste.
 */
const CANDIDATE_RANK: Record<QualificationRunStatus | 'not_started', number> = {
  promotable: 0,
  blocked: 1,
  running: 2,
  superseded: 3,
  aborted: 4,
  not_started: 5,
}

export function candidateRank(state: QualificationRunStatus | 'not_started'): number {
  return CANDIDATE_RANK[state]
}
