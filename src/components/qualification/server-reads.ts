import 'server-only'

/**
 * Les LECTURES serveur de la surface Qualification — RSC direct, jamais `/api`.
 *
 * Ce module compose des résolveurs qui existent déjà dans
 * `src/lib/agent-mission-control/**` : il n'écrit AUCUN nouveau chemin de
 * données et n'invente aucune dérivation. Ce qu'il ajoute est une chose et une
 * seule : l'ISOLATION des pannes. Chaque lecture est enveloppée séparément, si
 * bien qu'un registre muet dégrade SON panneau au lieu de faire tomber l'écran —
 * et surtout, une lecture qui échoue reste distinguable d'une lecture qui a
 * réussi sur une table vide.
 *
 * C'est la distinction qui compte le plus ici : `qualification_runs` et
 * `improvement_proposals` sont réellement vides en base. Un écran qui rendrait
 * pareil « je n'ai pas pu lire » et « il n'y a rien » transformerait une panne
 * en produit sain — donc chaque champ vient en paire (valeur, échec), et jamais
 * une valeur seule.
 *
 * Passer par `/api/agent-ops/**` pour LIRE ajouterait un aller-retour HTTP, une
 * seconde frontière d'authentification et une seconde occasion de diverger du
 * contrat. Les mutations, elles, passent obligatoirement par ces routes — voir
 * `console.tsx`.
 */
import { getAvailableAgent } from '@/lib/agent-mission-control/available-agents'
import {
  getBenchmarkSuitesForCopilot,
  getTestSuitesForCopilot,
  getVersionsForCopilot,
} from '@/lib/agent-mission-control/data'
import { getLatestProposalForCopilot } from '@/lib/agent-mission-control/improvement-loop'
import { pgrest } from '@/lib/agent-mission-control/postgrest'
import { evaluatePromotionGate } from '@/lib/agent-mission-control/promotion-gate'
import { resolvePromotionPolicy } from '@/lib/agent-mission-control/promotion-policy'
import { getLatestQualificationRun } from '@/lib/agent-mission-control/qualification-orchestrator'
import { evaluateReleaseGate } from '@/lib/agent-mission-control/release-gate'
import type {
  GateHistoryEntry,
  QualificationDetail,
  ReplayEvidence,
  ShadowEvidence,
} from './detail-screen'
import type { QualificationCandidate } from './roster-screen'

type RawRow = Record<string, unknown>

const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`

/**
 * Une lecture isolée : (valeur, échec). Jamais l'un sans l'autre.
 *
 * Le message d'échec est celui de l'erreur, non réécrit — il dit ce qui a
 * réellement lâché. `value` reste `null` sur échec, ce qui oblige l'appelant à
 * consulter `failure` pour savoir s'il s'agit d'une absence ou d'une panne.
 */
async function isolate<T>(read: () => Promise<T>): Promise<{ value: T | null; failure: string | null }> {
  try {
    return { value: await read(), failure: null }
  } catch (err) {
    return { value: null, failure: err instanceof Error ? err.message : 'lecture impossible' }
  }
}

/* ─────────────────── Le pointeur de production ─────────────────── */

interface CopilotPointer {
  id: string
  name: string
  productionVersionId: string | null
  latestVersionId: string | null
}

async function readCopilotPointer(copilotId: string): Promise<CopilotPointer | null> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `copilots?${eq('id', copilotId)}&select=id,name,production_version_id,latest_version_id`,
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id as string,
    name: (row.name as string) ?? (row.id as string),
    productionVersionId: (row.production_version_id as string | null) ?? null,
    latestVersionId: (row.latest_version_id as string | null) ?? null,
  }
}

/* ─────────────────── Preuves shadow / replay ─────────────────── */

async function readShadow(copilotId: string, versionId: string): Promise<ShadowEvidence | null> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `shadow_experiments?${eq('copilot_id', copilotId)}&${eq('candidate_version_id', versionId)}&select=id,status,candidate_verdict,sampled_run_count,would_mutate_count,started_at,ends_at,execution_mode&order=started_at.desc&limit=1`,
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id as string,
    status: (row.status as string) ?? 'inconnu',
    verdict: (row.candidate_verdict as string | null) ?? null,
    // `execution_mode` est passé BRUT : c'est `executionMode()` (model.ts) qui
    // décide, et une valeur inattendue retombe sur `legacy_unknown` plutôt que
    // d'être forcée en « live » — un mode inventé ferait passer une simulation
    // pour une preuve de production.
    executionMode: row.execution_mode,
    // Ces deux compteurs sont des COMPTES persistés par le moteur : un 0 y est
    // une valeur mesurée. `?? 0` serait un faux zéro si la colonne était nulle,
    // donc on garde la valeur numérique seulement quand elle en est une.
    sampledRunCount: typeof row.sampled_run_count === 'number' ? row.sampled_run_count : 0,
    wouldMutateCount: typeof row.would_mutate_count === 'number' ? row.would_mutate_count : 0,
    startedAt: (row.started_at as string | null) ?? null,
    endsAt: (row.ends_at as string | null) ?? null,
  }
}

async function readReplay(copilotId: string, versionId: string): Promise<ReplayEvidence | null> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `replay_comparisons?${eq('copilot_id', copilotId)}&${eq('candidate_version_id', versionId)}&select=id,status,verdict,case_count,created_at,execution_mode&order=created_at.desc&limit=1`,
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id as string,
    status: (row.status as string) ?? 'inconnu',
    verdict: (row.verdict as string | null) ?? null,
    executionMode: row.execution_mode,
    caseCount: typeof row.case_count === 'number' ? row.case_count : 0,
    createdAt: (row.created_at as string | null) ?? null,
  }
}

/**
 * L'historique des évaluations de gate — des OBSERVATIONS datées.
 *
 * Une évaluation archivée ne rouvre aucun droit : la RPC exige une évaluation
 * FRAÎCHE et passante. L'historique sert à comprendre ce qui a été jugé quand,
 * pas à justifier une promotion.
 */
async function readGateHistory(copilotId: string): Promise<GateHistoryEntry[]> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `promotion_gates?${eq('copilot_id', copilotId)}&select=id,candidate_version_id,gate_result,overall_status,last_evaluated_at&order=last_evaluated_at.desc&limit=25`,
  )
  return rows.map(
    (row): GateHistoryEntry => ({
      id: row.id as string,
      versionId: (row.candidate_version_id as string | null) ?? 'version inconnue',
      overall: (row.gate_result as string | null) ?? 'résultat non enregistré',
      // `ready` est le SEUL état que la RPC accepte. Toute autre valeur est un
      // blocage — jamais interprétée comme un succès partiel.
      promotable: row.overall_status === 'ready',
      evaluatedAt: (row.last_evaluated_at as string | null) ?? null,
    }),
  )
}

/* ─────────────────── La fiche complète ─────────────────── */

/**
 * Toutes les lectures d'une fiche de qualification, chacune isolée.
 *
 * Renvoie `undefined` quand le copilot n'existe PAS — un vrai 404, distinct
 * d'une lecture qui a échoué (qui, elle, jette et est traitée par la page).
 */
export async function loadQualificationDetail(
  copilotId: string,
): Promise<QualificationDetail | undefined> {
  const pointer = await readCopilotPointer(copilotId)
  if (pointer === null) return undefined

  // La version candidate suit la même règle que partout ailleurs :
  // `production_version_id ?? latest_version_id`. On ne réinvente pas la règle.
  const candidateVersionId = pointer.productionVersionId ?? pointer.latestVersionId

  const [agentRead, versionsRead, testSuitesRead, benchSuitesRead, proposalRead, historyRead] =
    await Promise.all([
      isolate(() => getAvailableAgent(copilotId)),
      isolate(() => getVersionsForCopilot(copilotId)),
      isolate(() => getTestSuitesForCopilot(copilotId)),
      isolate(() => getBenchmarkSuitesForCopilot(copilotId)),
      isolate(() => getLatestProposalForCopilot(copilotId)),
      isolate(() => readGateHistory(copilotId)),
    ])

  // Les lectures liées à la version candidate n'ont de sens QUE s'il en existe
  // une. Sans candidat, elles ne sont pas « échouées » : elles n'ont pas lieu
  // d'être, et le panneau le dira comme une absence de cible.
  const [gateRead, promotionRead, qualificationRead, shadowRead, replayRead] = candidateVersionId
    ? await Promise.all([
        isolate(() => evaluateReleaseGate(copilotId, candidateVersionId)),
        isolate(async () => {
          // La politique est résolue par copilot (stricte pour tout ce qui est
          // postérieur au basculement, fail-closed si indéterminable) : la
          // recopier en dur ici afficherait une gate évaluée sous une politique
          // qui n'est pas la sienne.
          const { policy } = await resolvePromotionPolicy(copilotId)
          return evaluatePromotionGate(copilotId, candidateVersionId, policy)
        }),
        isolate(() => getLatestQualificationRun(copilotId, candidateVersionId)),
        isolate(() => readShadow(copilotId, candidateVersionId)),
        isolate(() => readReplay(copilotId, candidateVersionId)),
      ])
    : [
        { value: null, failure: null },
        { value: null, failure: null },
        { value: null, failure: null },
        { value: null, failure: null },
        { value: null, failure: null },
      ]

  const versions = versionsRead.value ?? []
  const candidateVersion = candidateVersionId
    ? (versions.find((v) => v.id === candidateVersionId) ?? null)
    : null

  return {
    copilotId,
    copilotName: pointer.name,
    // `getAvailableAgent` rend `undefined` quand aucune ligne canonique ne
    // résout — un fait, pas une panne. On le normalise en `null` pour l'écran,
    // qui distingue les deux par le message plutôt que par le type.
    agent: agentRead.value ?? null,
    candidateVersion,
    productionVersionId: pointer.productionVersionId,
    // Le pointeur a été lu : `readCopilotPointer` a réussi, sinon on aurait jeté.
    productionRead: true,
    versions,
    testSuites: testSuitesRead.value ?? [],
    benchmarkSuites: benchSuitesRead.value ?? [],
    releaseGate: gateRead.value ?? null,
    releaseGateFailure: gateRead.failure,
    promotionGate: promotionRead.value ?? null,
    promotionGateFailure: promotionRead.failure,
    qualificationRun: qualificationRead.value ?? null,
    qualificationFailure: qualificationRead.failure,
    shadow: shadowRead.value ?? null,
    shadowFailure: shadowRead.failure,
    replay: replayRead.value ?? null,
    replayFailure: replayRead.failure,
    proposal: proposalRead.value ?? null,
    proposalFailure: proposalRead.failure,
    gateHistory: historyRead.value ?? [],
    gateHistoryFailure: historyRead.failure,
  }
}

/* ─────────────────── Le banc ─────────────────── */

/**
 * La liste des candidats — une ligne par copilot du catalogue.
 *
 * Deux lectures batchées (les copilots, puis les propositions ouvertes), et une
 * lecture de qualification PAR candidat. Ce fan-out est assumé : l'état d'une
 * qualification est indexé par (copilot, version) et il n'existe aucune lecture
 * agrégée dans le périmètre serveur. Chaque lecture est isolée, donc un registre
 * muet marque SA ligne « non lue » au lieu de la faire passer pour vide.
 */
export async function loadQualificationRoster(): Promise<{
  candidates: QualificationCandidate[]
  qualificationReadFailures: number
}> {
  const copilotRows = await pgrest<RawRow[]>(
    'GET',
    'copilots?select=id,name,production_version_id,latest_version_id&order=name',
  )

  // Les propositions OUVERTES, en une seule lecture. Un échec ici ne doit pas
  // faire tomber le banc : on retombe sur « aucune boucle connue », et c'est
  // dit par l'absence de badge, jamais par un badge « aucune boucle ».
  const openProposals = await isolate(() =>
    pgrest<RawRow[]>(
      'GET',
      'improvement_proposals?status=in.(proposed,v2-created)&select=copilot_id',
    ),
  )
  const openByCopilot = new Set(
    (openProposals.value ?? []).map((row) => row.copilot_id as string),
  )

  const agentsRead = await isolate(async () => {
    const { getAvailableAgents } = await import('@/lib/agent-mission-control/available-agents')
    return getAvailableAgents()
  })
  const agentById = new Map((agentsRead.value ?? []).map((a) => [a.copilotId, a]))

  let qualificationReadFailures = 0

  const candidates = await Promise.all(
    copilotRows.map(async (row): Promise<QualificationCandidate> => {
      const copilotId = row.id as string
      const productionVersionId = (row.production_version_id as string | null) ?? null
      const candidateVersionId = productionVersionId ?? ((row.latest_version_id as string | null) ?? null)

      const agent = agentById.get(copilotId) ?? null
      // Le nombre de conditions NON tenues, dérivé du contrat canonique. Sans
      // contrat, il reste 0 et l'écran affiche « garde satisfaite » — ce qui
      // serait faux : on marque donc 3 pour dire « rien ne prouve la garde ».
      const runBlockerCount = agent
        ? [
            agent.status === 'active',
            agent.unresolvedToolIds.length === 0,
            agent.runtime === 'langgraph',
          ].filter((ok) => !ok).length
        : 3

      let state: QualificationCandidate['state'] = 'not_started'
      let qualificationRead = true
      let candidateLabel: string | null = null
      let candidateStage: string | null = null

      if (candidateVersionId) {
        const [runRead, versionRead] = await Promise.all([
          isolate(() => getLatestQualificationRun(copilotId, candidateVersionId)),
          isolate(() =>
            pgrest<RawRow[]>(
              'GET',
              `copilot_versions?${eq('id', candidateVersionId)}&select=label,stage&limit=1`,
            ),
          ),
        ])
        if (runRead.failure !== null) {
          qualificationRead = false
          qualificationReadFailures += 1
        } else if (runRead.value) {
          state = runRead.value.status
        }
        const versionRow = versionRead.value?.[0]
        candidateLabel = (versionRow?.label as string | null) ?? null
        candidateStage = (versionRow?.stage as string | null) ?? null
      }

      return {
        copilotId,
        name: (row.name as string) ?? copilotId,
        candidateVersionId,
        candidateLabel,
        candidateStage,
        state,
        qualificationRead,
        hasProductionBaseline: productionVersionId !== null,
        hasOpenProposal: openByCopilot.has(copilotId),
        runBlockerCount,
      }
    }),
  )

  return { candidates, qualificationReadFailures }
}
