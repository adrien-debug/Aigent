/**
 * Dérivations PURES de la surface Livraison — aucune I/O, aucun React.
 *
 * Ce module porte le cœur de la PR : la SÉPARATION STRICTE des états de
 * livraison. Il est isolé des composants parce que ces règles sont exactement
 * celles qu'un écran a le plus de facilité à confondre, et qu'elles doivent se
 * tester sans DOM ni backend.
 *
 * LA CONFUSION QU'ON REFUSE
 * -------------------------
 * « L'agent est livré » n'est pas UN état, c'en est huit, et sept d'entre eux
 * ont été affichés comme un seul dans des consoles précédentes :
 *
 *   1. shipping_disabled       — l'environnement ne PEUT pas écrire sur GitHub.
 *   2. dry_run_done            — un essai a eu lieu, RIEN n'a été écrit.
 *   3. confirmation_required   — armé, mais l'opérateur n'a pas confirmé.
 *   4. push_succeeded          — un commit existe réellement sur le dépôt.
 *   5. pr_opened               — une PR existe ; elle n'est PAS mergée pour autant.
 *   6. merge_unknown           — INCONNUE STRUCTURELLE.
 *   7. consumer_activation_unknown — INCONNUE STRUCTURELLE.
 *   8. no_consumer_telemetry   — FAIT MESURÉ, pas un vide.
 *
 * LES TROIS DERNIERS NE SONT PAS DES ÉCHECS.
 * ------------------------------------------
 * Après provisioning, **Aigent ne fait que POUSSER** (`AGENTS.md` § Shipping).
 * Les gestes `activate` / `rebind` / `deploy-version` appartiennent au workspace
 * CONSOMMATEUR, qui n'expose aucun canal de lecture vers Aigent. C'est la raison
 * STRUCTURELLE — pas un bug, pas une donnée manquante — pour laquelle
 * `active_in_consumer` vaut le littéral `'unknown'` dans la trace de cycle de
 * vie (gate `check:lifecycle-truth`).
 *
 * Rendre ces trois-là en rouge, ou en « 0 », serait deux mensonges à la fois :
 * affirmer un échec là où il n'y a pas de mesure, et laisser croire qu'un canal
 * existe et qu'il a répondu.
 *
 * LE HUITIÈME EST DIFFÉRENT, ET C'EST IMPORTANT.
 * ---------------------------------------------
 * « Aucun agent déployé n'a jamais rapporté de run » est une chose qu'Aigent
 * SAIT : la table `runtime_telemetry_events` est lisible, elle a été lue, et
 * zéro de ses lignes porte une provenance `consumer`. C'est un FAIT MESURÉ sur
 * une lecture RÉUSSIE — l'exact opposé d'une inconnue. D'où `evidence` porté par
 * l'état : il distingue « lu, et il n'y a rien » de « pas lu ».
 */

import type { DeliveryEvent } from '@/lib/agent-mission-control/delivery-events-store'
import type { TargetRepoSandboxReport } from '@/lib/agent-mission-control/target-repo-sandbox'
import type { AgentDeliveryScorecard, DeliveryLevel } from '@/lib/agent-mission-control/delivery-scorecard'

/* ═════════════════════ Les huit états de livraison ═════════════════════ */

export type DeliveryStateId =
  | 'shipping_disabled'
  | 'dry_run_done'
  | 'confirmation_required'
  | 'push_succeeded'
  | 'pr_opened'
  | 'merge_unknown'
  | 'consumer_activation_unknown'
  | 'no_consumer_telemetry'

/**
 * La NATURE d'un état — ce qui décide comment l'écran a le droit de le peindre.
 *
 * `structural_unknown` est le mode le plus important : il interdit à l'UI de
 * traiter l'état comme un problème. Un état structurellement inconnu n'a pas de
 * couleur de sévérité, il a une EXPLICATION.
 */
export type DeliveryStateKind =
  /** Une configuration du serveur, ni bonne ni mauvaise en soi. */
  | 'configuration'
  /** Un événement qui a réellement eu lieu et qu'Aigent a observé. */
  | 'observed'
  /** Aigent n'a AUCUN canal pour savoir. Jamais un échec. */
  | 'structural_unknown'
  /** Une lecture a RÉUSSI et son résultat est « rien ». Un fait, pas un vide. */
  | 'measured_absence'

export interface DeliveryState {
  id: DeliveryStateId
  /** Libellé court — celui de l'écran, jamais réécrit ailleurs. */
  label: string
  kind: DeliveryStateKind
  /**
   * `true` quand cet état est ATTEINT dans la situation observée.
   *
   * `null` — et pas `false` — quand la question n'a pas pu être posée : lecture
   * non faite, non lisible. `false` affirmerait que l'état n'est PAS atteint.
   */
  reached: boolean | null
  /** Ce que l'état signifie exactement. Repris tel quel dans l'écran. */
  meaning: string
  /**
   * La PREUVE : ce qui a été lu et ce que ça a donné. `null` quand rien n'a été
   * lu — ce qui est distinct d'une preuve vide.
   */
  evidence: string | null
}

/* ─────────────── Les significations, à un seul endroit ─────────────── */

const MEANING: Record<DeliveryStateId, string> = {
  // Le texte nomme les DEUX verrous sans nommer la variable d'environnement du
  // second : un écran qui indiquerait quoi poser pour ouvrir une écriture
  // distante destructive serait un mode d'emploi de contournement de sa propre
  // garantie. L'opérateur a besoin de savoir que le verrou est fermé et
  // pourquoi — pas de savoir comment l'ouvrir depuis cette page.
  shipping_disabled:
    'Cet environnement ne peut pas écrire sur GitHub. Une écriture réelle exige DEUX verrous : la confirmation explicite de l’opérateur dans la requête, ET un verrou d’environnement côté serveur. Tant que le second est fermé, toute livraison part et reste en dry-run — c’est la garantie produit, pas une panne.',
  dry_run_done:
    'Un essai a été effectué. RIEN n’a été écrit sur le dépôt distant : aucun commit, aucune branche, aucune PR. Un dry-run vert ne prouve pas qu’une écriture réelle réussirait, il prouve que le paquet a été construit.',
  confirmation_required:
    'L’écriture réelle attend une confirmation explicite de l’opérateur. C’est le premier des deux verrous ; il ne suffit pas à lui seul.',
  push_succeeded:
    'Un commit existe réellement sur le dépôt cible. C’est le fait le plus fort qu’Aigent puisse établir sur une livraison.',
  pr_opened:
    'Une pull request existe sur le dépôt cible. Une PR ouverte n’est PAS une PR mergée — et Aigent ne relit pas son état.',
  merge_unknown:
    'Aigent n’interroge pas l’état de merge d’une PR après l’avoir ouverte. Ni mergée, ni refusée : NON SU. Le dépôt cible appartient au consommateur, qui décide seul.',
  consumer_activation_unknown:
    'Après le provisioning, Aigent ne fait que POUSSER. Les gestes activate / rebind / deploy-version appartiennent au workspace consommateur, qui n’expose aucun canal de lecture vers Aigent. C’est pourquoi `active_in_consumer` vaut le littéral « unknown » — une inconnue structurelle, jamais un échec.',
  no_consumer_telemetry:
    'La table de télémétrie a été LUE, et aucun de ses événements ne porte une provenance « consumer ». Ce n’est pas un vide d’affichage : c’est le constat mesuré qu’aucun agent déployé n’a jamais rapporté de run à Aigent.',
}

const LABEL: Record<DeliveryStateId, string> = {
  shipping_disabled: 'Shipping désactivé',
  dry_run_done: 'Dry-run effectué',
  confirmation_required: 'Confirmation requise',
  push_succeeded: 'Push réussi',
  pr_opened: 'PR ouverte',
  merge_unknown: 'Merge inconnu',
  consumer_activation_unknown: 'Activation consommateur inconnue',
  no_consumer_telemetry: 'Aucune télémétrie consommateur',
}

const KIND: Record<DeliveryStateId, DeliveryStateKind> = {
  shipping_disabled: 'configuration',
  dry_run_done: 'observed',
  confirmation_required: 'configuration',
  push_succeeded: 'observed',
  pr_opened: 'observed',
  merge_unknown: 'structural_unknown',
  consumer_activation_unknown: 'structural_unknown',
  no_consumer_telemetry: 'measured_absence',
}

export const DELIVERY_STATE_ORDER: readonly DeliveryStateId[] = [
  'shipping_disabled',
  'confirmation_required',
  'dry_run_done',
  'push_succeeded',
  'pr_opened',
  'merge_unknown',
  'consumer_activation_unknown',
  'no_consumer_telemetry',
]

function shippingDisabledEvidence(realDeliveryEnabled: boolean | null): string | null {
  if (realDeliveryEnabled === null) return null
  if (realDeliveryEnabled) return 'Le serveur déclare une écriture GitHub réelle possible.'
  return 'Le serveur déclare l’écriture GitHub réelle impossible ici. Toute livraison retombera en dry-run.'
}

function confirmationRequiredEvidence(realDeliveryEnabled: boolean | null): string | null {
  if (realDeliveryEnabled === null) return null
  if (realDeliveryEnabled) {
    return 'Le second verrou est armé côté serveur : seule la confirmation explicite manque.'
  }
  return 'Sans le verrou serveur, une confirmation ne suffirait pas à écrire.'
}

function pushSucceededEvidence(
  deliveryRead: boolean,
  delivery: DeliveryEvent | null,
): string | null {
  if (!deliveryRead) return null
  if (delivery === null) return 'Aucun événement de livraison persisté pour cet agent.'
  if (delivery.commitSha !== null) {
    return 'Commit ' + delivery.commitSha.slice(0, 7) + ' sur ' + delivery.targetRepo + '.'
  }
  return 'Événement de livraison présent, sans SHA de commit enregistré.'
}

function prOpenedEvidence(deliveryRead: boolean, delivery: DeliveryEvent | null): string | null {
  if (!deliveryRead) return null
  if (delivery === null) return 'Aucun événement de livraison persisté pour cet agent.'
  if (delivery.prUrl === null) return 'Livraison en commit direct — aucune PR n’a été ouverte.'
  const prLabel = delivery.prNumber !== null ? '#' + delivery.prNumber : 'ouverte'
  return 'PR ' + prLabel + ' sur ' + delivery.targetRepo + '.'
}

function consumerTelemetryEvidence(
  consumerTelemetryCount: number | null,
  telemetryEventCount: number | null,
): string | null {
  if (consumerTelemetryCount === null) return null
  if (telemetryEventCount === null) {
    return consumerTelemetryCount + ' événement(s) de provenance « consumer » lus.'
  }
  return (
    consumerTelemetryCount +
    ' événement(s) de provenance « consumer » sur ' +
    telemetryEventCount +
    ' événement(s) lus.'
  )
}

/* ═════════════════════ Ce que l'écran observe ═════════════════════ */

/**
 * Les faits déjà LUS, en paires (valeur, lecture-réussie).
 *
 * Chaque champ nullable vient avec son booléen de lecture. Sans cette paire,
 * `latestDelivery === null` serait ambigu : « aucune livraison » ou « je n'ai
 * pas pu lire la table » ? Les deux produisent des états de livraison
 * radicalement différents, et la surface refuse de les confondre.
 */
export interface DeliveryObservation {
  /**
   * `realDeliveryEnabled` de `/api/agent-ops/delivery-capability` — un seul
   * booléen, délibérément : le serveur ne dit JAMAIS quel verrou manque, ce
   * serait une carte des secrets à aller poser.
   *
   * `null` = la capacité n'a pas été lue.
   */
  realDeliveryEnabled: boolean | null
  /** Le dernier événement de livraison persisté, ou `null`. */
  latestDelivery: DeliveryEvent | null
  /** `false` ⇒ `latestDelivery === null` par IGNORANCE, pas par absence. */
  deliveryRead: boolean
  /**
   * Nombre d'événements de télémétrie de provenance `consumer`.
   * `null` ⇒ la télémétrie n'a pas été lue. `0` ⇒ lue, et il n'y en a aucun.
   */
  consumerTelemetryCount: number | null
  /** Total d'événements lus, toutes provenances — le dénominateur du fait. */
  telemetryEventCount: number | null
}

/* ═════════════════════ La dérivation ═════════════════════ */

/**
 * Les huit états, dérivés d'une observation. JAMAIS de `?? 0`, jamais de
 * `false` par défaut : une question non posée reste `reached: null`.
 *
 * Les deux inconnues structurelles sont toujours `reached: true` — elles ne
 * dépendent d'aucune lecture, elles sont vraies par construction du produit.
 * C'est précisément ce qui les distingue des six autres.
 */
export function deriveDeliveryStates(obs: DeliveryObservation): DeliveryState[] {
  const state = (id: DeliveryStateId, reached: boolean | null, evidence: string | null): DeliveryState => ({
    id,
    label: LABEL[id],
    kind: KIND[id],
    reached,
    meaning: MEANING[id],
    evidence,
  })

  const d = obs.deliveryRead ? obs.latestDelivery : null

  return [
    // 1. Shipping désactivé — lu depuis la capacité serveur, jamais deviné.
    state(
      'shipping_disabled',
      obs.realDeliveryEnabled === null ? null : !obs.realDeliveryEnabled,
      shippingDisabledEvidence(obs.realDeliveryEnabled),
    ),

    // 2. Confirmation requise — vrai dès que l'environnement pourrait écrire.
    //    Quand le shipping est désactivé, la confirmation n'est PAS suffisante :
    //    l'état n'est alors pas « atteint », il est sans objet.
    state(
      'confirmation_required',
      obs.realDeliveryEnabled === null ? null : obs.realDeliveryEnabled,
      confirmationRequiredEvidence(obs.realDeliveryEnabled),
    ),

    // 3. Dry-run effectué. Un dry-run n'écrit RIEN, donc il ne laisse aucune
    //    trace persistée : `agent_delivery_events` n'enregistre que les
    //    livraisons RÉELLES (push-agent/route.ts ne persiste que sur
    //    `pushed && !dryRun`). Aigent ne peut donc pas prouver qu'un dry-run a
    //    eu lieu — c'est `null`, jamais `false`.
    state(
      'dry_run_done',
      null,
      'Un dry-run n’écrit rien et n’est jamais persisté : seules les livraisons réelles entrent dans `agent_delivery_events`. Un dry-run de cette session s’affiche dans son propre panneau, pas ici.',
    ),

    // 4. Push réussi — un commit réel.
    state(
      'push_succeeded',
      obs.deliveryRead ? d !== null && d.commitSha !== null : null,
      pushSucceededEvidence(obs.deliveryRead, d),
    ),

    // 5. PR ouverte.
    state(
      'pr_opened',
      obs.deliveryRead ? d !== null && d.prUrl !== null : null,
      prOpenedEvidence(obs.deliveryRead, d),
    ),

    // 6. Merge inconnu — INCONNUE STRUCTURELLE, vraie par construction.
    state(
      'merge_unknown',
      true,
      'Aucun chemin de code d’Aigent ne relit l’état d’une PR après son ouverture.',
    ),

    // 7. Activation consommateur inconnue — INCONNUE STRUCTURELLE.
    state(
      'consumer_activation_unknown',
      true,
      'Aucun canal de lecture d’Aigent vers un workspace consommateur n’existe. `active_in_consumer` reste le littéral « unknown ».',
    ),

    // 8. Aucune télémétrie consommateur — FAIT MESURÉ.
    state(
      'no_consumer_telemetry',
      obs.consumerTelemetryCount === null ? null : obs.consumerTelemetryCount === 0,
      consumerTelemetryEvidence(obs.consumerTelemetryCount, obs.telemetryEventCount),
    ),
  ]
}

/* ═════════════════════ Lecture d'une ligne de livraison ═════════════════════ */

/**
 * Ce que la table `agent_delivery_events` porte pour UN agent, traduit pour
 * l'écran. Aucun champ n'est fabriqué : ce qui n'est pas enregistré reste `null`
 * et se rend « non enregistré », jamais « aucun ».
 */
export interface DeliveryRow {
  copilotId: string
  copilotName: string
  /** `null` ⇒ aucun projet rattaché, donc aucun dépôt cible possible. */
  projectId: string | null
  projectName: string | null
  repoFullName: string | null
  /** `false` ⇒ la lecture de l'événement a échoué pour CETTE ligne. */
  deliveryRead: boolean
  latestDelivery: DeliveryEvent | null
}

/**
 * Le mode de livraison, en français, sans inventer.
 * Une valeur inconnue est rendue telle quelle plutôt que rangée d'office dans
 * l'un des deux modes connus.
 */
export function deliveryModeLabel(mode: string | null): string | null {
  if (mode === null) return null
  if (mode === 'pull_request') return 'Pull request'
  if (mode === 'direct_commit') return 'Commit direct'
  return mode
}

/**
 * Ordre d'affichage du roster de livraison : ce qui est livré se lit en premier
 * (c'est ce sur quoi il y a quelque chose à dire), puis les non livrés, puis les
 * lignes NON LUES en dernier — une ligne non lue n'est pas une ligne vide et ne
 * doit pas se noyer parmi elles.
 */
function deliveryRank(r: DeliveryRow): number {
  if (!r.deliveryRead) return 2
  return r.latestDelivery !== null ? 0 : 1
}

export function sortDeliveryRows(rows: readonly DeliveryRow[]): DeliveryRow[] {
  return rows.toSorted(
    (a, b) => deliveryRank(a) - deliveryRank(b) || a.copilotName.localeCompare(b.copilotName, 'fr'),
  )
}

/**
 * Compteurs du roster — dérivés de la MÊME liste que l'écran affiche.
 *
 * `notRead` n'est pas un détail : sans lui, une panne de lecture gonflerait
 * silencieusement `neverDelivered` et l'écran annoncerait « 12 agents jamais
 * livrés » alors qu'il n'en sait rien.
 */
export interface DeliveryCounts {
  total: number
  delivered: number
  neverDelivered: number
  notRead: number
  withPr: number
  withCommit: number
  /** Agents sans dépôt cible : une livraison y est impossible, pas « en attente ». */
  withoutRepo: number
}

export function countDeliveryRows(rows: readonly DeliveryRow[]): DeliveryCounts {
  const read = rows.filter((r) => r.deliveryRead)
  return {
    total: rows.length,
    delivered: read.filter((r) => r.latestDelivery !== null).length,
    neverDelivered: read.filter((r) => r.latestDelivery === null).length,
    notRead: rows.filter((r) => !r.deliveryRead).length,
    withPr: read.filter((r) => r.latestDelivery?.prUrl != null).length,
    withCommit: read.filter((r) => r.latestDelivery?.commitSha != null).length,
    withoutRepo: rows.filter((r) => r.repoFullName === null).length,
  }
}

/* ═════════════════════ Scorecard ═════════════════════ */

export const SCORECARD_LEVEL_LABEL: Record<DeliveryLevel, string> = {
  not_ready: 'Pas prêt',
  safe: 'Sûr',
  delivery_ready: 'Livrable',
  excellent: 'Excellent',
}

export const SCORECARD_LEVEL_MEANING: Record<DeliveryLevel, string> = {
  not_ready:
    'Un bloqueur est présent, ou le score agrégé reste sous 50. La livraison n’est pas défendable en l’état.',
  safe: 'Aucun bloqueur, mais des preuves manquent : l’agent n’est pas dangereux, il n’est pas prouvé adapté.',
  delivery_ready: 'Score ≥ 70 sans bloqueur — la livraison est défendable.',
  excellent: 'Score ≥ 85 sans bloqueur — l’agent est prouvé adapté à son dépôt.',
}

/**
 * Le score de la scorecard n'est affiché QUE lorsqu'il repose sur des dimensions
 * réellement mesurées.
 *
 * `computeDeliveryScorecard` rend toujours un nombre : une somme pondérée sur
 * zéro dimension mesurée vaut 0, et ce 0 se lirait comme « noté zéro ». Ce n'est
 * pas la même affirmation que « rien n'a été mesuré ». La règle ci-dessous est
 * la seule barrière entre les deux — et c'est pour ça qu'elle est ici, pure et
 * testée, plutôt qu'en ligne dans un composant.
 */
export function scorecardScoreIsMeaningful(card: AgentDeliveryScorecard): boolean {
  return card.dimensions.some((d) => d.status !== 'missing')
}

/** Les dimensions réellement mesurées, sur le total. Jamais un ratio inventé. */
export function scorecardMeasuredRatio(card: AgentDeliveryScorecard): { measured: number; total: number } {
  return {
    measured: card.dimensions.filter((d) => d.status !== 'missing').length,
    total: card.dimensions.length,
  }
}

/* ═════════════════════ Sandbox ═════════════════════ */

/**
 * Ce que le rapport de sandbox prouve — et surtout ce qu'il ne prouve pas.
 *
 * `dry_run` est le mode par DÉFAUT du collecteur : les scripts du dépôt cible
 * sont DÉTECTÉS, jamais exécutés. Un rapport `passed` en dry-run ne dit donc
 * rien sur le fait que `npm run build` du consommateur passerait — il dit que
 * les artefacts livrés sont là et bien formés.
 */
export function sandboxModeMeaning(report: TargetRepoSandboxReport): string {
  return report.executionMode === 'execute'
    ? 'Mode « execute » : les scripts du dépôt cible ont réellement tourné dans un clone jetable.'
    : 'Mode « dry-run » : les scripts du dépôt cible ont été DÉTECTÉS, jamais exécutés. Un verdict vert ne prouve donc rien sur leur résultat.'
}

/**
 * Les compteurs de checks du sandbox, par statut. Ce sont des COMPTES sur une
 * liste réellement présente — pas des métriques nullables.
 */
export function countSandboxChecks(report: TargetRepoSandboxReport): {
  passed: number
  failed: number
  warning: number
  skipped: number
  total: number
} {
  const by = (s: string) => report.checks.filter((c) => c.status === s).length
  return {
    passed: by('passed'),
    failed: by('failed'),
    warning: by('warning'),
    skipped: by('skipped'),
    total: report.checks.length,
  }
}
