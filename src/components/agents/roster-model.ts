/**
 * Dérivations PURES du roster d'agents — aucune I/O, aucun React.
 *
 * Ce module est le seul endroit où le contrat canonique `AvailableAgent` est
 * traduit en ce que l'écran montre. Il est séparé des composants pour une raison
 * précise : ces règles sont testables sans DOM ni backend, et ce sont elles qui
 * portent les vérités produit que l'UI ne doit PAS réinventer.
 *
 * TROIS RÈGLES TENUES ICI
 * ----------------------
 * 1. **`unavailableFields` fait autorité sur l'absence.** Un champ nommé dans ce
 *    tableau n'a pas été mesuré. Il ne se rend jamais comme une valeur, même si
 *    le champ porte techniquement une valeur de repli (`readOnly` reste `false`
 *    quand la nature est inconnaissable — le contrat le dit explicitement).
 * 2. **`active` signifie PROUVÉ.** Le statut runtime (`status`) et le statut de
 *    cycle de vie (`lifecycleStatus`) sont DEUX faits distincts, affichés côte à
 *    côte et jamais fusionnés. Le catalogue dérive `active` d'un chemin
 *    d'exécution réel ; `lifecycleStatus` est la décision de l'opérateur.
 * 3. **Aucun provider fabriqué.** `provider === null` se dit « non résolu », pas
 *    « openai ». Le câblage d'un provider est un fait connu (AGENTS.md) et se
 *    dit séparément de sa résolution.
 */
import type { AvailableAgent, AvailableAgentStatus } from '@/lib/agent-mission-control/available-agents'
import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'

/* ─────────────────────────── Vocabulaire ─────────────────────────── */

/**
 * Statut RUNTIME — ce que le catalogue peut prouver aujourd'hui.
 * Distinct du statut de cycle de vie, volontairement : les deux se lisent
 * ensemble sur la ligne, jamais l'un à la place de l'autre.
 */
export const RUNTIME_STATUS_LABEL: Record<AvailableAgentStatus, string> = {
  active: 'Actif',
  inactive: 'Inactif',
  degraded: 'Dégradé',
  // Le MÊME mot que le produit entier emploie pour une absence, pris à la
  // constante et jamais réécrit : deux orthographes du même concept finissent
  // toujours par diverger.
  unavailable: UNAVAILABLE_LABEL,
}

/** Ce que chaque statut runtime affirme réellement — repris tel quel en `title`. */
export const RUNTIME_STATUS_MEANING: Record<AvailableAgentStatus, string> = {
  active:
    'Chemin d’exécution complet ET version en service. « Actif » est un fait dérivé du runtime, jamais un simple statut posé à la main.',
  inactive: 'Exécutable, mais délibérément pas en service (brouillon ou en pause).',
  degraded:
    'Le chemin d’exécution existe mais des outils déclarés ne résolvent vers aucun handler enregistré : l’agent ne peut pas faire ce qu’il annonce.',
  unavailable:
    'Pas exécutable : agent retiré (archivé), ou une exigence dure manque (projet, provider, modèle, version ou manifeste).',
}

/** Statut de CYCLE DE VIE — la colonne `copilots.status`, non altérée. */
export const LIFECYCLE_STATUS_LABEL: Record<string, string> = {
  active: 'Actif',
  paused: 'En pause',
  draft: 'Brouillon',
  archived: 'Archivé',
}

export function lifecycleStatusLabel(status: string): string {
  return LIFECYCLE_STATUS_LABEL[status] ?? status
}

/* ─────────────────────────── Providers ─────────────────────────── */

/**
 * Câblage réel des providers (AGENTS.md § « Runtime multi-provider »).
 *
 * `mistral` est déclarable mais NON câblé : le model-router lève une erreur
 * typée, il n'y a pas de repli muet. C'est un fait produit que l'écran doit
 * montrer — un agent configuré sur mistral ne tournera pas, et le voir sur la
 * fiche évite de chercher la panne ailleurs.
 */
export type ProviderWiring = 'wired' | 'opt-in' | 'not-wired' | 'unknown'

const PROVIDER_WIRING: Record<string, ProviderWiring> = {
  openai: 'wired',
  google: 'wired',
  // vLLM : câblé, mais jamais atteint sans opt-in explicite.
  local: 'opt-in',
  // Déclaré par le schéma, exécuté par personne.
  mistral: 'not-wired',
}

/**
 * Le câblage d'un provider. `null` (non résolu) rend `'unknown'` — l'absence de
 * provider n'est pas un provider non câblé : on ne sait pas lequel il aurait
 * fallu joindre.
 */
export function providerWiring(provider: string | null): ProviderWiring {
  if (provider === null) return 'unknown'
  return PROVIDER_WIRING[provider] ?? 'unknown'
}

export const PROVIDER_WIRING_DETAIL: Record<ProviderWiring, string> = {
  wired: 'Provider câblé — le model-router sait l’atteindre.',
  'opt-in': 'Provider câblé mais opt-in explicite (vLLM) : sans activation, aucun appel ne part.',
  'not-wired':
    'Provider NON câblé : le model-router lève une erreur typée, sans repli. Un agent configuré ainsi ne peut pas tourner.',
  unknown: 'Provider non résolu depuis les données persistées — impossible de dire ce qui serait joint.',
}

/* ─────────────────────────── Absence ─────────────────────────── */

/**
 * Un champ nommé dans `unavailableFields` n'a PAS été mesuré.
 *
 * C'est la seule question que l'UI doit poser avant de rendre une valeur : le
 * contrat garde des valeurs de repli non nullables (`readOnly: false`) qu'il
 * faut refuser d'afficher quand le champ est déclaré indisponible.
 */
export function isUnavailable(agent: AvailableAgent, field: string): boolean {
  return agent.unavailableFields.includes(field)
}

/* ─────────────────────────── Tri du roster ─────────────────────────── */

/**
 * Ordre de gravité : ce qui est cassé se lit en premier.
 *
 * `degraded` passe devant `unavailable` parce qu'un agent dégradé est un agent
 * qu'on croyait bon — c'est l'écart le plus coûteux à ignorer. `unavailable`
 * suit (souvent une décision assumée : archivage). Les agents sains ferment la
 * marche, triés par nom pour rester stables d'un rendu à l'autre.
 */
const STATUS_RANK: Record<AvailableAgentStatus, number> = {
  degraded: 0,
  unavailable: 1,
  inactive: 2,
  active: 3,
}

export function sortRoster(agents: readonly AvailableAgent[]): AvailableAgent[] {
  return [...agents].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name, 'fr'),
  )
}

/* ─────────────────────────── Compteurs ─────────────────────────── */

export interface RosterCounts {
  total: number
  active: number
  inactive: number
  degraded: number
  unavailable: number
  /** Agents dont un outil déclaré ne résout vers aucun handler. */
  withUnresolvedTools: number
  /**
   * Agents dont le DERNIER run a prouvé le modèle exécuté. Ce n'est pas « agents
   * vérifiés » : les autres sont simplement non prouvés, ce qui est une autre
   * affirmation que « faux ».
   */
  withProvenExecutedModel: number
}

/**
 * Compteurs dérivés de la MÊME liste que le roster affiche.
 *
 * Recompter depuis une seconde requête est exactement ce qui laisse un chiffre
 * diverger de la liste qu'il prétend résumer.
 */
export function countRoster(agents: readonly AvailableAgent[]): RosterCounts {
  const by = (s: AvailableAgentStatus) => agents.filter((a) => a.status === s).length
  return {
    total: agents.length,
    active: by('active'),
    inactive: by('inactive'),
    degraded: by('degraded'),
    unavailable: by('unavailable'),
    withUnresolvedTools: agents.filter((a) => a.unresolvedToolIds.length > 0).length,
    withProvenExecutedModel: agents.filter((a) => a.executedModel !== null).length,
  }
}
