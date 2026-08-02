/**
 * Dérivations PURES de la preuve — gate de release, trace de cycle de vie.
 *
 * Aucune I/O, aucun React. Ce module existe pour que les trois vocabulaires
 * d'absence du produit restent DISTINCTS jusqu'au pixel, au lieu d'être écrasés
 * en un « pas OK » générique une ligne avant le rendu :
 *
 *  · `pass` / `fail`   — la mesure a été prise, et elle tranche.
 *  · `missing`         — la mesure n'a JAMAIS été prise. Ça bloque une promotion
 *                        exactement comme un `fail`, mais ça ne dit pas la même
 *                        chose : « non mesuré » n'accuse personne, `fail` si.
 *  · `unknown`         — pour une étape de cycle de vie : Aigent n'a pas de canal
 *                        de lecture qui a abouti sans rien prouver.
 *  · `unavailable`     — la lecture elle-même a ÉCHOUÉ. « Je n'ai pas pu lire »
 *                        n'est pas « j'ai lu, rien à signaler » : les deux
 *                        s'affichent différemment, sinon une panne se lit comme
 *                        un produit sain.
 *
 * Le release-gate rend désormais `missing` sur un compteur de sécurité non
 * mesuré (auparavant il rendait `pass`, ce qui promouvait sur une preuve
 * absente). L'UI doit donc rendre trois états, pas deux.
 */
import type { GateStatus, ReleaseCheck } from '@/lib/agent-mission-control/release-gate'
import type { LifecycleStage } from '@/lib/agent-mission-control/agent-lifecycle-trace'

/* ─────────────────────── Gate de release ─────────────────────── */

/**
 * Le ton d'un check. `missing` a son propre ton — ni le vert d'un `pass`, ni le
 * rouge d'un `fail` — parce qu'il porte une affirmation différente. Le statut
 * lui-même (`GateStatus`) porte ce ton ; pas d'indirection.
 */
export const GATE_STATUS_LABEL: Record<GateStatus, string> = {
  pass: 'Vérifié',
  fail: 'Échoué',
  missing: 'Non mesuré',
}

/**
 * Ce que chaque état affirme — rendu en `title`, pour que la distinction ne
 * repose pas uniquement sur une couleur.
 */
export const GATE_STATUS_MEANING: Record<GateStatus, string> = {
  pass: 'La mesure a été prise sur des runs live et elle satisfait l’exigence.',
  fail: 'La mesure a été prise et elle viole l’exigence.',
  missing:
    'La mesure n’a jamais été prise. Ce n’est PAS un succès : un signal absent bloque la promotion au même titre qu’un échec, mais il n’accuse rien — il constate qu’il n’y a rien à lire.',
}

export interface GateSummary {
  total: number
  passed: number
  failed: number
  /** Checks dont le signal n'a jamais été mesuré — ils bloquent aussi. */
  missing: number
  /** Vrai seulement quand TOUS les checks passent. Un `missing` l'interdit. */
  promotable: boolean
  /**
   * Nombre de checks qui BLOQUENT (échec + non mesuré). C'est le chiffre utile
   * pour un opérateur : il dit combien d'obstacles restent, sans laisser croire
   * qu'un « non mesuré » serait un demi-succès.
   */
  blocking: number
}

/**
 * Résumé d'une liste de checks. `promotable` est recalculé ici depuis les checks
 * eux-mêmes plutôt que recopié : c'est la même règle que le gate serveur
 * (`checks.every(pass)`), et la dupliquer sous cette forme rend impossible un
 * affichage « promouvable » posé sur des checks qui ne le disent pas.
 */
export function summarizeGate(checks: readonly ReleaseCheck[]): GateSummary {
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

/**
 * Ordre d'affichage : ce qui bloque en premier, `fail` avant `missing`.
 *
 * Un échec est un fait établi contre le candidat ; un non-mesuré est un trou à
 * combler. Les deux bloquent, mais l'opérateur agit différemment sur chacun, et
 * l'ordre le dit sans avoir à l'écrire.
 */
const GATE_RANK: Record<GateStatus, number> = { fail: 0, missing: 1, pass: 2 }

export function sortChecks(checks: readonly ReleaseCheck[]): ReleaseCheck[] {
  return [...checks].sort((a, b) => GATE_RANK[a.status] - GATE_RANK[b.status])
}

/* ─────────────────────── Cycle de vie ─────────────────────── */

/**
 * L'état d'affichage d'une étape. `unknown` est un TROISIÈME état, jamais replié
 * sur « pas atteinte » :
 *
 *  · `reached`     — atteinte, avec une preuve mesurée.
 *  · `not-reached` — pas atteinte, et on l'a VÉRIFIÉ (lecture réussie, rien trouvé).
 *  · `unknown`     — la lecture a eu lieu, elle n'a rien prouvé. Cas normal de
 *                    `active_in_consumer` sans preuve d'exécution récente : le
 *                    silence d'un consommateur est ambigu (agent au repos,
 *                    réseau coupé, agent désinstallé donnent le même signal),
 *                    donc jamais de rouge — l'absence de preuve n'est pas une
 *                    preuve d'absence.
 *  · `unavailable` — la lecture a ÉCHOUÉ. Distinct d'`unknown` : on n'a pas pu
 *                    regarder, on n'a donc rien constaté du tout.
 */
export type StageDisplay = 'reached' | 'not-reached' | 'unknown' | 'unavailable'

export function stageDisplay(stage: LifecycleStage): StageDisplay {
  // L'indisponible se teste EN PREMIER : il ne doit jamais retomber sur
  // `unknown`, qui affirmerait une lecture réussie qui n'a pas eu lieu.
  if (stage.reached === 'unavailable' || stage.evidence.state === 'unavailable') return 'unavailable'
  if (stage.reached === 'unknown') return 'unknown'
  // Une étape dont la PREUVE est inconnue ne peut pas être affirmée atteinte,
  // même si le booléen dit `false` : un `false` posé sur une lecture échouée
  // n'est pas une absence constatée. On retombe sur `unknown`.
  if (stage.evidence.state === 'unknown') return 'unknown'
  return stage.reached ? 'reached' : 'not-reached'
}

export const STAGE_DISPLAY_LABEL: Record<StageDisplay, string> = {
  reached: 'Atteinte',
  'not-reached': 'Pas atteinte',
  unknown: 'Inconnue',
  unavailable: 'Lecture impossible',
}

export const STAGE_DISPLAY_MEANING: Record<StageDisplay, string> = {
  reached: 'La preuve a été lue et elle établit l’étape.',
  'not-reached': 'La lecture a réussi et l’étape n’est pas atteinte.',
  unknown: 'La lecture a réussi et n’a rien prouvé. Ce n’est pas une preuve du contraire.',
  unavailable:
    'La lecture a ÉCHOUÉ. Rien n’a été constaté, dans aucun sens — ce n’est pas « rien à signaler ».',
}

/**
 * `active_in_consumer` a désormais un canal de lecture réel : la route
 * consommateur authentifiée écrit des événements portant un `installation_id`
 * vérifié en temps constant, et `consumer-activation.ts` en tire le verdict.
 *
 * L'ancienne mention « inconnaissable d'ici » est donc FAUSSE et a été retirée
 * de l'écran. Ce qui reste vrai, et que cette fonction sert à dire : l'étape se
 * lit sur des événements du CONSOMMATEUR, jamais sur une livraison, un statut
 * Aigent ou un run interne. Un `unknown` y signifie « aucune exécution récente
 * prouvée », jamais « l'agent est inactif ».
 */
export function isConsumerReportedStage(stage: LifecycleStage): boolean {
  return stage.key === 'active_in_consumer'
}

/* ─────────────────── Nature d'un obstacle de lancement ─────────────────── */

/**
 * De quelle NATURE est un obstacle — la distinction que l'écran doit rendre.
 *
 * `computeBlockers` répond à une seule question : « un run peut-il partir ? ».
 * Sa réponse est juste, mais elle est BINAIRE, et l'écran la peignait telle
 * quelle : tout obstacle sortait en rouge critique sous le titre « Lancement
 * bloqué ». Un agent dont on n'a simplement jamais résolu la version se lisait
 * donc exactement comme un agent qui déclare trois outils que le runner ne sait
 * pas exécuter.
 *
 * Ce sont deux affirmations différentes, et `AGENTS.md § Vérité des données`
 * exige de ne pas les confondre :
 *
 *  · `proven`  — une mesure a été prise et elle est NÉGATIVE. Quelque chose est
 *                cassé, nommément : un outil déclaré sans handler exécutable,
 *                un runtime qui n'est pas LangGraph. Le rouge est mérité.
 *  · `absent`  — rien n'a été mesuré, ou une donnée requise n'a jamais été
 *                résolue. Personne n'a échoué : il n'y a rien à lire. Le rouge
 *                y serait un mensonge — il accuserait une panne qui n'existe
 *                pas.
 *
 * La classification se fait sur le `code` de l'obstacle, qui est stable et
 * défini au même endroit que les obstacles eux-mêmes (`agent-detail.ts`). Le
 * DÉFAUT est `absent` : un code inconnu de cette table ne doit pas hériter du
 * rouge par accident — on n'invente pas une panne qu'on n'a pas prouvée.
 */
export type BlockerNature = 'proven' | 'absent'

/**
 * Les codes qui portent un fait mesuré ET négatif. Tout le reste est une
 * absence.
 *
 * `unresolved-tools` : le registre a été lu, les handlers cherchés, et ils
 * n'existent pas — c'est une contradiction interne prouvée, pas un trou.
 *
 * `runtime-not-langgraph` : le runtime est RENSEIGNÉ et vaut autre chose que
 * `langgraph`. La valeur est là, elle est lue, et elle interdit l'exécution.
 * (Un runtime NON résolu, lui, arrive par `missing-*` et reste une absence.)
 */
const PROVEN_BLOCKER_CODES: ReadonlySet<string> = new Set([
  'unresolved-tools',
  'runtime-not-langgraph',
])

/**
 * Le `code` d'un obstacle `status` porte le statut canonique dans son `label`,
 * pas dans son code — il faut donc regarder le statut lui-même. `degraded` est
 * le seul statut qui affirme un fait négatif prouvé (le catalogue a constaté des
 * outils inexécutables) ; `unavailable` et `inactive` disent tous deux une
 * absence : une donnée requise manque, ou l'activation n'a jamais eu lieu.
 */
export function blockerNature(code: string, agentStatus: string | undefined): BlockerNature {
  if (PROVEN_BLOCKER_CODES.has(code)) return 'proven'
  if (code === 'status') return agentStatus === 'degraded' ? 'proven' : 'absent'
  return 'absent'
}

/**
 * Le verdict de la fiche, dérivé de la NATURE de ses obstacles.
 *
 * Trois issues, pas deux — c'est tout l'objet de cette passe :
 *  · `launchable`   — aucun obstacle.
 *  · `blocked`      — au moins un obstacle PROUVÉ. Rouge, titre « bloqué ».
 *  · `unmeasured`   — des obstacles, mais tous des absences. Neutre.
 */
export type ServiceVerdict = 'launchable' | 'blocked' | 'unmeasured'

export function serviceVerdict(
  blockers: readonly { code: string }[],
  agentStatus: string | undefined,
): ServiceVerdict {
  if (blockers.length === 0) return 'launchable'
  const hasProven = blockers.some((b) => blockerNature(b.code, agentStatus) === 'proven')
  return hasProven ? 'blocked' : 'unmeasured'
}
