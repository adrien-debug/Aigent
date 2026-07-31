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
 *                        de lecture. Structurellement inconnaissable.
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
 * rouge d'un `fail` — parce qu'il porte une affirmation différente.
 */
export type GateTone = 'pass' | 'fail' | 'missing'

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

export function gateTone(status: GateStatus): GateTone {
  return status
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
 *  · `unknown`     — Aigent ne peut pas savoir. C'est le cas permanent de
 *                    `active_in_consumer` : il n'existe aucun canal de lecture
 *                    vers l'état d'activation d'un workspace consommateur, donc
 *                    rendre cette étape en vert OU en rouge serait une invention.
 */
export type StageDisplay = 'reached' | 'not-reached' | 'unknown'

export function stageDisplay(stage: LifecycleStage): StageDisplay {
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
}

/**
 * `active_in_consumer` est la seule étape structurellement inconnaissable : elle
 * l'est par construction, pas par accident de lecture. Le distinguer permet à
 * l'écran de dire « Aigent ne peut pas le savoir » plutôt que « la lecture a
 * échoué » — deux causes très différentes pour un opérateur qui cherche à
 * comprendre pourquoi une case est grise.
 */
export function isStructurallyUnknowable(stage: LifecycleStage): boolean {
  return stage.key === 'active_in_consumer'
}
