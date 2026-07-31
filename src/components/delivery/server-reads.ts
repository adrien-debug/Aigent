import 'server-only'

/**
 * Les LECTURES serveur de la surface Livraison — RSC direct, jamais `/api`.
 *
 * Ce module compose des résolveurs qui existent déjà dans
 * `src/lib/agent-mission-control/**` (`getLatestDeliveryEvent`,
 * `getDeliveryScorecard`, `getLatestSandboxReport`, `getConsumerProvisionStatus`,
 * `listRecentRuntimeTelemetryEvents`). Il n'écrit AUCUN nouveau chemin de données
 * et n'invente aucune dérivation.
 *
 * Ce qu'il ajoute est l'ISOLATION des pannes : chaque lecture est enveloppée
 * séparément, si bien qu'une table muette dégrade SON panneau au lieu de faire
 * tomber l'écran — et surtout, une lecture qui échoue reste distinguable d'une
 * lecture qui a réussi sur une table vide.
 *
 * C'est la distinction qui compte le plus ici. `agent_delivery_events` porte UNE
 * ligne, et aucun événement de télémétrie ne porte une provenance `consumer`.
 * Ce sont des FAITS mesurés. Un écran qui rendrait pareil « je n'ai pas pu lire »
 * et « il n'y a rien » transformerait cette vérité produit — qu'aucun agent
 * déployé n'a jamais rapporté de run — en une simple panne d'affichage.
 *
 * AUCUNE ÉCRITURE. Ce module ne poste rien, n'appelle aucune route mutante,
 * n'arme aucun verrou. `getConsumerProvisionStatus` est une lecture de fichier
 * GitHub (`aigent/consumer-ready.json`) via l'API Contents ; elle n'écrit pas.
 */
import { getLatestDeliveryEvent } from '@/lib/agent-mission-control/delivery-events-store'
import { getDeliveryScorecard } from '@/lib/agent-mission-control/delivery-scorecard-server'
import { getConsumerProvisionStatus } from '@/lib/agent-mission-control/github'
import { pgrest } from '@/lib/agent-mission-control/postgrest'
import { classifyRuntimeTelemetryProvenance } from '@/lib/agent-mission-control/runtime-telemetry-provenance'
import { listRecentRuntimeTelemetryEvents } from '@/lib/agent-mission-control/runtime-telemetry-store'
import { getLatestSandboxReport } from '@/lib/agent-mission-control/sandbox-reports-store'
import type { AgentDeliveryScorecard } from '@/lib/agent-mission-control/delivery-scorecard'
import type { TargetRepoSandboxReport } from '@/lib/agent-mission-control/target-repo-sandbox'
import type { DeliveryEvent } from '@/lib/agent-mission-control/delivery-events-store'

import type { DeliveryRow } from './model'

type RawRow = Record<string, unknown>

const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`

/**
 * Une lecture isolée : (valeur, échec). Jamais l'un sans l'autre.
 *
 * Le message d'échec est celui de l'erreur, non réécrit — il dit ce qui a
 * réellement lâché. `value` reste `null` sur échec, ce qui OBLIGE l'appelant à
 * consulter `failure` pour savoir s'il s'agit d'une absence ou d'une panne.
 */
async function isolate<T>(read: () => Promise<T>): Promise<{ value: T | null; failure: string | null }> {
  try {
    return { value: await read(), failure: null }
  } catch (err) {
    return { value: null, failure: err instanceof Error ? err.message : 'lecture impossible' }
  }
}

/* ═════════════════ Télémétrie de provenance consommateur ═════════════════ */

/**
 * Le FAIT central de cette surface : combien d'événements de télémétrie
 * proviennent réellement d'un agent déployé chez un consommateur.
 *
 * La classification n'est pas réinventée ici : `classifyRuntimeTelemetryProvenance`
 * est la règle du produit, et elle ne déduit JAMAIS « consumer » de l'absence
 * d'un marqueur interne (doctrine : inconnu tant que ce n'est pas positivement
 * prouvé). Recopier cette logique dans un composant, c'est garantir qu'elle
 * dérivera.
 *
 * `limit` est haut mais borné : cette lecture affirme « sur les N derniers
 * événements », jamais « sur tous ». L'écran reprend ce dénominateur tel quel.
 */
export const TELEMETRY_SCAN_LIMIT = 500

export interface ConsumerTelemetryFact {
  /** Événements de provenance `consumer` parmi ceux lus. */
  consumerCount: number
  /** Total d'événements lus — le dénominateur du fait, jamais implicite. */
  scannedCount: number
  /** Plafond de la lecture : `scannedCount === limit` ⇒ il y en a peut-être plus. */
  limit: number
}

async function readConsumerTelemetryFact(): Promise<ConsumerTelemetryFact> {
  const events = await listRecentRuntimeTelemetryEvents(TELEMETRY_SCAN_LIMIT)
  return {
    consumerCount: events.filter((e) => classifyRuntimeTelemetryProvenance(e) === 'consumer').length,
    scannedCount: events.length,
    limit: TELEMETRY_SCAN_LIMIT,
  }
}

/* ═════════════════ Capacité de livraison ═════════════════ */

/**
 * Le serveur peut-il écrire réellement sur GitHub ?
 *
 * On relit les MÊMES trois préconditions que `/api/agent-ops/delivery-capability`
 * et que `push-agent/route.ts` — mais depuis un composant serveur, sans
 * aller-retour HTTP. La valeur retournée est UN booléen, exactement comme la
 * route : ni le nom d'une variable, ni le détail de quel verrou manque. Un corps
 * du genre `{ tokenPresent: false }` serait une carte des secrets à aller poser.
 *
 * ⚠️ Cette fonction LIT `process.env.GITHUB_PUSH_ENABLED`. Elle ne l'arme pas,
 * ne le suggère pas, et ne l'écrit nulle part. Lire un verrou pour DIRE qu'il
 * est fermé est l'opposé de l'ouvrir.
 */
export function readDeliveryCapability(): boolean {
  const backendConfigured =
    process.env.AMC_DATA_SOURCE === 'gpu1' &&
    Boolean(process.env.AMC_SUPABASE_URL) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  const githubConfigured = Boolean(process.env.GITHUB_TOKEN)
  // Strict '1' — toute autre valeur (y compris 'true') laisse le verrou fermé.
  const pushArmed = process.env.GITHUB_PUSH_ENABLED === '1'
  return backendConfigured && githubConfigured && pushArmed
}

/* ═════════════════ Le roster de livraison ═════════════════ */

export interface DeliveryRosterRead {
  rows: DeliveryRow[]
  /** Nombre de lectures d'événement qui ont ÉCHOUÉ — jamais confondu avec zéro livraison. */
  deliveryReadFailures: number
  /** Le fait télémétrie, ou `null` si la lecture a échoué. */
  telemetry: ConsumerTelemetryFact | null
  telemetryFailure: string | null
  /** La capacité serveur — toujours lisible (aucune I/O). */
  realDeliveryEnabled: boolean
}

/**
 * Le roster : une ligne par copilot, avec son dernier événement de livraison.
 *
 * Les copilots et les projets sont lus en deux requêtes batchées ; l'événement
 * de livraison est ensuite lu PAR copilot. Ce fan-out est assumé :
 * `agent_delivery_events` est indexée par copilot et il n'existe aucune lecture
 * agrégée dans le périmètre serveur. Chaque lecture est isolée, donc une table
 * muette marque SA ligne « non lue » au lieu de la faire passer pour « jamais
 * livrée ».
 *
 * On lit `copilots` directement plutôt que `getCopilots()` : ce dernier
 * déclenche un fan-out d'enrichissement santé (pass rate, benchmark, latence,
 * KPI 24 h) dont cette surface n'affiche RIEN. Payer ces allers-retours pour les
 * jeter serait un coût sans lecteur.
 *
 * JETTE quand le registre des copilots est injoignable — la page traite ce cas
 * en « indisponible », jamais en liste vide.
 */
export async function loadDeliveryRoster(): Promise<DeliveryRosterRead> {
  const copilotRows = await pgrest<RawRow[]>(
    'GET',
    'copilots?select=id,name,project_id&order=name',
  )

  // Les projets en UNE lecture — le dépôt cible d'un agent vient de son projet.
  // Un échec ici ne fait pas tomber l'écran : le dépôt devient « non lu », ce
  // qui se dit, plutôt que « aucun dépôt », qui serait faux.
  const projectsRead = await isolate(() =>
    pgrest<RawRow[]>('GET', 'projects?select=id,name,repo_full_name'),
  )
  const projectById = new Map(
    (projectsRead.value ?? []).map((row) => [
      row.id as string,
      {
        name: (row.name as string | null) ?? (row.id as string),
        repoFullName: (row.repo_full_name as string | null) ?? null,
      },
    ]),
  )

  const telemetryRead = await isolate(readConsumerTelemetryFact)

  let deliveryReadFailures = 0

  const rows = await Promise.all(
    copilotRows.map(async (row): Promise<DeliveryRow> => {
      const copilotId = row.id as string
      const projectId = (row.project_id as string | null) ?? null
      const project = projectId ? projectById.get(projectId) : undefined

      const eventRead = await isolate(() => getLatestDeliveryEvent(copilotId))
      if (eventRead.failure !== null) deliveryReadFailures += 1

      return {
        copilotId,
        copilotName: (row.name as string | null) ?? copilotId,
        projectId,
        projectName: project?.name ?? null,
        // `undefined` (projet non lu) et `null` (projet sans dépôt) ne se
        // confondent pas : sans lecture de projet on ne prétend pas savoir.
        repoFullName: project?.repoFullName ?? null,
        deliveryRead: eventRead.failure === null,
        latestDelivery: eventRead.value,
      }
    }),
  )

  return {
    rows,
    deliveryReadFailures,
    telemetry: telemetryRead.value,
    telemetryFailure: telemetryRead.failure,
    realDeliveryEnabled: readDeliveryCapability(),
  }
}

/* ═════════════════ La fiche d'un agent ═════════════════ */

export interface DeliveryDetailRead {
  copilotId: string
  copilotName: string
  /** `null` ⇒ aucun projet rattaché : aucune livraison n'est possible. */
  projectId: string | null
  projectName: string | null
  repoFullName: string | null
  /** `false` ⇒ le projet n'a pas pu être lu — distinct de « pas de projet ». */
  projectRead: boolean

  latestDelivery: DeliveryEvent | null
  deliveryFailure: string | null

  scorecard: AgentDeliveryScorecard | null
  scorecardFailure: string | null

  sandbox: TargetRepoSandboxReport | null
  sandboxFailure: string | null

  /** Provisioning du pack consommateur, lu depuis le dépôt cible. */
  consumerProvisioned: boolean | null
  consumerPackVersion: string | null
  consumerProvisionedAt: string | null
  consumerFailure: string | null

  telemetry: ConsumerTelemetryFact | null
  telemetryFailure: string | null

  realDeliveryEnabled: boolean
}

/**
 * Toutes les lectures d'une fiche de livraison, chacune isolée.
 *
 * Renvoie `undefined` quand le copilot n'existe PAS — un vrai 404, distinct
 * d'une lecture qui a échoué (qui, elle, jette et est traitée par la page).
 * Cette distinction est ce qui permet à la page d'appeler `notFound()` hors de
 * tout `try/catch` : `notFound()` fonctionne en levant, et l'attraper le
 * transformerait en erreur 500.
 */
export async function loadDeliveryDetail(copilotId: string): Promise<DeliveryDetailRead | undefined> {
  const copilotRows = await pgrest<RawRow[]>(
    'GET',
    `copilots?${eq('id', copilotId)}&select=id,name,project_id&limit=1`,
  )
  const copilot = copilotRows[0]
  if (!copilot) return undefined

  const projectId = (copilot.project_id as string | null) ?? null

  const projectRead = projectId
    ? await isolate(() =>
        pgrest<RawRow[]>(
          'GET',
          `projects?${eq('id', projectId)}&select=id,name,repo_full_name&limit=1`,
        ),
      )
    : { value: null, failure: null }

  const projectRow = projectRead.value?.[0]
  const repoFullName = (projectRow?.repo_full_name as string | null) ?? null

  const [deliveryRead, scorecardRead, sandboxRead, telemetryRead] = await Promise.all([
    isolate(() => getLatestDeliveryEvent(copilotId)),
    isolate(() => getDeliveryScorecard(copilotId)),
    isolate(() => getLatestSandboxReport(copilotId)),
    isolate(readConsumerTelemetryFact),
  ])

  // L'état de provisioning consommateur se lit dans le DÉPÔT CIBLE. Sans dépôt,
  // la question n'a pas d'objet : ce n'est ni un échec ni un « non provisionné »,
  // c'est une absence de cible, et l'écran le dira comme tel.
  const consumerRead = repoFullName
    ? await isolate(() => getConsumerProvisionStatus(repoFullName))
    : { value: null, failure: null }

  return {
    copilotId,
    copilotName: (copilot.name as string | null) ?? copilotId,
    projectId,
    projectName: (projectRow?.name as string | null) ?? null,
    repoFullName,
    projectRead: projectRead.failure === null,

    latestDelivery: deliveryRead.value,
    deliveryFailure: deliveryRead.failure,

    scorecard: scorecardRead.value,
    scorecardFailure: scorecardRead.failure,

    sandbox: sandboxRead.value,
    sandboxFailure: sandboxRead.failure,

    consumerProvisioned: consumerRead.value ? consumerRead.value.provisioned : null,
    consumerPackVersion: consumerRead.value?.version ?? null,
    consumerProvisionedAt: consumerRead.value?.provisionedAt ?? null,
    consumerFailure: consumerRead.failure,

    telemetry: telemetryRead.value,
    telemetryFailure: telemetryRead.failure,

    realDeliveryEnabled: readDeliveryCapability(),
  }
}
