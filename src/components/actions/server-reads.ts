/**
 * Lecture serveur de la file opérateur — le SEUL point d'I/O de `/actions`.
 *
 * Pourquoi ce module existe séparément de `operator-queue.ts` : celui-ci est
 * PUR (donc testable sans backend), celui-là fait les appels réseau et absorbe
 * leurs pannes. Garder la dérivation hors du module d'I/O est ce qui permet aux
 * vingt tests de la file de tourner offline.
 *
 * TROIS LECTURES, TROIS PANNES INDÉPENDANTES
 * ------------------------------------------
 * L'aperçu, les runs et les propositions d'amélioration tombent séparément. Une
 * lecture qui échoue devient un `null` ATTRIBUÉ, jamais un tableau vide : la
 * file doit pouvoir dire « je n'ai pas pu regarder » plutôt que de laisser un
 * opérateur lire une file calme comme « rien à traiter ». C'est le contrat à
 * trois états de `dashboard-overview.ts`, appliqué ici aux deux sources que
 * l'aperçu ne porte pas.
 *
 * COÛT : la lecture des propositions est un N+1 assumé et BORNÉ — une requête
 * par copilot, `getLatestProposalForCopilot` n'ayant pas d'équivalent batché.
 * Le plafond `PROPOSAL_SCAN_LIMIT` existe pour que ce coût ne suive jamais la
 * taille de la flotte ; au-delà, la file le DIT (`proposalScanTruncated`) au
 * lieu de tronquer en silence.
 */
import 'server-only'

import {
  FULL_ACTION_QUEUE_LIMIT,
  getDashboardOverview,
  type DashboardOverview,
} from '@/lib/agent-mission-control/dashboard-overview'
import { getLatestProposalForCopilot } from '@/lib/agent-mission-control/improvement-loop'
import { getRecentRunsInWindow } from '@/lib/agent-mission-control/data'
import {
  buildOperatorQueue,
  selectOpenDecisions,
  selectPendingConfirmations,
  type OperatorQueue,
} from '@/lib/agent-mission-control/operator-queue'

/**
 * Nombre maximum de copilots dont on scanne la dernière proposition.
 *
 * Ce n'est pas une limite esthétique : c'est le garde-fou du N+1. Trente
 * requêtes bornées restent sous la seconde ; trois cents ne le seraient pas.
 * Les copilots sont scannés dans l'ordre du roster, donc de façon déterministe.
 */
export const PROPOSAL_SCAN_LIMIT = 30

export type ActionsPageData = {
  queue: OperatorQueue
  /** Vrai quand tous les copilots n'ont pas été scannés — dit à l'écran. */
  proposalScanTruncated: boolean
  /** Nombre de copilots réellement scannés, pour l'afficher tel quel. */
  proposalScanCount: number
}

export async function getActionsPageData(nowMs: number = Date.now()): Promise<ActionsPageData> {
  // L'aperçu porte déjà les sept catégories héritées ; on lui demande la file
  // COMPLÈTE (pas la tranche de six du cockpit).
  const overviewResult = await getDashboardOverview(nowMs, {
    actionItemsLimit: FULL_ACTION_QUEUE_LIMIT,
  })
    .then((overview) => ({ overview, failed: false as const }))
    .catch((err: unknown) => {
      console.error('[actions] dashboard overview read failed', err)
      return { overview: null, failed: true as const }
    })

  const overview: DashboardOverview | null = overviewResult.overview

  // Les runs de la fenêtre canonique 24h — même borne que partout ailleurs,
  // pour que « en attente de confirmation » veuille dire la même chose ici et
  // sur `/runs`.
  const pendingConfirmations = await getRecentRunsInWindow({ nowMs })
    .then((runs) => selectPendingConfirmations(runs))
    .catch((err: unknown) => {
      console.error('[actions] window runs read failed', err)
      return null
    })

  const copilots = overview?.copilots ?? []
  const scanned = copilots.slice(0, PROPOSAL_SCAN_LIMIT)

  // N+1 borné, en parallèle. Une proposition illisible pour UN copilot ne doit
  // pas faire tomber la file entière : chaque lecture absorbe sa propre panne
  // et le résultat global ne devient `null` que si TOUTES ont échoué — sinon on
  // rendrait invisible une file partiellement lisible.
  const proposalResults =
    scanned.length === 0
      ? []
      : await Promise.all(
          scanned.map((copilot) =>
            getLatestProposalForCopilot(copilot.id).catch((err: unknown) => {
              console.error('[actions] proposal read failed', copilot.id, err)
              return undefined
            })
          )
        )

  const everyProposalReadFailed =
    proposalResults.length > 0 && proposalResults.every((result) => result === undefined)

  const openDecisions = everyProposalReadFailed
    ? null
    : selectOpenDecisions(
        proposalResults.filter((proposal): proposal is NonNullable<typeof proposal> => Boolean(proposal))
      )

  const queue = buildOperatorQueue({
    actionItems: overview?.actionItems ?? [],
    pendingConfirmations,
    openDecisions,
    copilotsById: new Map(copilots.map((copilot) => [copilot.id, copilot])),
    projectsById: new Map((overview?.projectRows ?? []).map((project) => [project.id, project])),
    dataWarnings: overview
      ? overview.dataWarnings
      : // L'aperçu entier est tombé : on ne peut pas prétendre que les sept
        // catégories héritées sont vides, on dit qu'elles sont absentes.
        ["Le plan de contrôle n'a pas pu être lu : les actions de livraison, gate et mission sont absentes de cette file."],
    composedAt: new Date(nowMs).toISOString(),
  })

  return {
    queue,
    proposalScanTruncated: copilots.length > scanned.length,
    proposalScanCount: scanned.length,
  }
}
