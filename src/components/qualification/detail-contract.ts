/**
 * Les CONTRATS de la fiche de qualification — types et dérivations, zéro rendu.
 *
 * Ce module s'appelait `detail-screen.tsx` et portait, en plus de ces contrats,
 * dix panneaux de rendu et un écran de 1212 lignes. Le rendu est passé à
 * `cockpit-screen.tsx` lors du rework de la page Market Intelligence ; ce qui
 * reste ici est ce que PLUSIEURS surfaces consomment :
 *
 *  · `QualificationDetail` — la forme complète lue par `server-reads.ts` ;
 *  · les trois preuves optionnelles (`ShadowEvidence`, `ReplayEvidence`,
 *    `GateHistoryEntry`) ;
 *  · `buildConsoleTarget` — la cible du poste de commande, dérivée serveur.
 *
 * Extension `.ts` et non `.tsx` : plus une ligne de JSX, et le nom dit
 * maintenant ce que le fichier contient.
 */
import type { AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import type { ReleaseGate } from '@/lib/agent-mission-control/release-gate'
import type { PromotionGateResult } from '@/lib/agent-mission-control/promotion-gate'
import type { QualificationRun } from '@/lib/agent-mission-control/qualification-orchestrator'
import type { ImprovementProposal } from '@/lib/agent-mission-control/improvement-loop'
import type { BenchmarkSuite, CopilotVersion, TestSuite } from '@/lib/agent-mission-control/types'
import type { ConsoleTarget } from './console'
import {
  canGenerateSuites,
  isProposalOpen,
  runGuardConditions,
  suiteReadState,
  summarizeChecks,
} from './model'

/* ─────────────────── Les preuves shadow / replay lues ─────────────────── */

/** La dernière expérience shadow persistée pour ce candidat, telle que lue. */
export interface ShadowEvidence {
  id: string
  status: string
  verdict: string | null
  executionMode: unknown
  /** Compte persisté. `null` ⇒ la colonne n'a jamais été écrite, PAS zéro. */
  sampledRunCount: number | null
  /**
   * Compte persisté des appels d'outils mutants interceptés.
   *
   * `null` est structurel ici : un 0 se lit comme la PREUVE que le shadow a tout
   * intercepté. Confondre « jamais enregistré » avec « aucune mutation tentée »
   * transformerait une absence de mesure en certificat d'innocuité.
   */
  wouldMutateCount: number | null
  startedAt: string | null
  endsAt: string | null
}

/** La dernière comparaison replay persistée pour ce candidat, telle que lue. */
export interface ReplayEvidence {
  id: string
  status: string
  verdict: string | null
  executionMode: unknown
  /** Compte persisté. `null` ⇒ non enregistré, jamais « 0 cas comparés ». */
  caseCount: number | null
  createdAt: string | null
}

/** Une évaluation de gate archivée — l'historique, jamais une re-dérivation. */
export interface GateHistoryEntry {
  id: string
  versionId: string
  overall: string
  promotable: boolean
  evaluatedAt: string | null
}

export interface QualificationDetail {
  copilotId: string
  copilotName: string
  /** Le contrat canonique. `null` ⇒ aucune ligne canonique ne résout. */
  agent: AvailableAgent | null
  candidateVersion: CopilotVersion | null
  productionVersionId: string | null
  /** La lecture du pointeur de production a-t-elle abouti ? */
  productionRead: boolean
  versions: CopilotVersion[]
  /** `null` ⇒ la lecture a abouti. Une liste vide sur un échec n'est PAS un vide prouvé. */
  versionsFailure: string | null
  testSuites: TestSuite[]
  testSuitesFailure: string | null
  benchmarkSuites: BenchmarkSuite[]
  benchmarkSuitesFailure: string | null
  releaseGate: ReleaseGate | null
  releaseGateFailure: string | null
  promotionGate: PromotionGateResult | null
  promotionGateFailure: string | null
  qualificationRun: QualificationRun | null
  qualificationFailure: string | null
  shadow: ShadowEvidence | null
  shadowFailure: string | null
  replay: ReplayEvidence | null
  replayFailure: string | null
  proposal: ImprovementProposal | null
  proposalFailure: string | null
  gateHistory: GateHistoryEntry[]
  gateHistoryFailure: string | null
}



/* ─── Deux dérivations que `buildConsoleTarget` consomme ─── */

/**
 * La promotion est-elle autorisée ? La gate de promotion prime quand elle
 * existe (elle intègre le rollup de la release gate) ; sinon on retombe sur la
 * release gate seule. Aucune des deux ⇒ `false` : dans le doute, on n'ouvre pas
 * une action qui écrit en production.
 */
function resolvePromotable(detail: QualificationDetail): boolean {
  if (detail.promotionGate) return detail.promotionGate.promotable
  if (detail.releaseGate) return summarizeChecks(detail.releaseGate.checks).promotable
  return false
}

/** L'identifiant de la boucle d'amélioration OUVERTE, s'il y en a une. */
function openProposalIdFrom(proposal: ImprovementProposal | null): string | null {
  if (!isProposalOpen(proposal)) return null
  return proposal?.id ?? null
}

/* ─── Le constructeur de cible pour le poste de commande ─── */

export function buildConsoleTarget(detail: QualificationDetail): ConsoleTarget {
  const conditions = detail.agent ? runGuardConditions(detail.agent) : []
  const runBlockers = conditions.filter((c) => !c.satisfied).map((c) => c.label + ' — ' + c.observed)

  const promotable = resolvePromotable(detail)

  // Une lecture de versions échouée ne rend pas « aucune version archivée » :
  // le retour arrière reste éteint avec sa raison plutôt que d'être proposé sur
  // une cible qu'on n'a pas pu lire.
  const archived =
    detail.versionsFailure === null
      ? (detail.versions.find((v) => v.stage === 'archived') ?? null)
      : null

  // Les suites ont-elles été LUES ? Sans cette réponse, `testSuiteId === null`
  // veut dire deux choses opposées — « aucune suite n'existe » (la génération
  // facturée est le bon geste) et « on n'a pas pu lire » (la génération
  // regénérerait peut-être des suites qui existent déjà, pour de l'argent réel).
  const testState = suiteReadState(detail.testSuites, detail.testSuitesFailure)
  const benchState = suiteReadState(detail.benchmarkSuites, detail.benchmarkSuitesFailure)

  return {
    copilotId: detail.copilotId,
    candidateVersionId: detail.candidateVersion?.id ?? null,
    candidateLabel: detail.candidateVersion?.label ?? null,
    suitesRead: testState.read && benchState.read,
    canGenerateSuites: canGenerateSuites(testState, benchState),
    testSuiteId: testState.firstId,
    benchmarkSuiteId: benchState.firstId,
    versionsRead: detail.versionsFailure === null,
    productionVersionId: detail.productionVersionId,
    productionRead: detail.productionRead,
    rollbackTargetId: archived?.id ?? null,
    rollbackTargetLabel: archived?.label ?? null,
    openProposalId: openProposalIdFrom(detail.proposal),
    proposalId: detail.proposal?.id ?? null,
    proposalStatus: detail.proposal?.status ?? null,
    promotable,
    runBlockers,
  }
}
