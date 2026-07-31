/**
 * Vocabulaire de statut du cockpit — une seule définition pour l'écran ENTIER.
 *
 * Ces valeurs sont littérales et non des `var(--…)` parce que Recharts les
 * consomme aussi bien en `fill` SVG qu'en interpolation d'animation : une
 * variable CSS y passerait au rendu mais pas au calcul. Les garder ici, en dur
 * et en un seul endroit, est ce qui empêche une puce de légende et sa barre de
 * diverger silencieusement.
 *
 * Palette validée pour la vision des couleurs (deutan / protan / tritan) sur la
 * surface `--surface-raised` #131618 : bande de clarté OKLCH 0.48–0.67, chroma
 * ≥ 0.1, séparation ΔE de la pire paire adjacente ≥ 20 en vision normale et
 * ≥ 20 en protan/deutan. La couleur n'est jamais le SEUL porteur d'identité —
 * chaque statut voyage avec son libellé.
 */
import type { AgentRunStatus } from '@/lib/agent-mission-control/types'

/**
 * Les cinq teintes de sévérité du produit, et RIEN d'autre — la seule palette
 * de statut de tout le cockpit. `RUN_STATUS_COLOR` et le `SEVERITY` consommé
 * par `cockpit/primitives.tsx` (jauges, rails de liste) en dérivent tous les
 * deux : avant cette réconciliation, les deux fichiers redéclaraient chacun
 * une palette proche mais pas identique (`#3d82ee` vs `#3b82f6` pour
 * « en cours »), une dérive qu'une deuxième source rend inévitable à terme.
 */
export const SEVERITY = {
  good: '#0da87f',
  running: '#3d82ee',
  warn: '#be850f',
  blocked: '#8e63ee',
  bad: '#e8455f',
  muted: 'rgb(161 161 170 / 0.35)',
} as const

/** Ordre d'empilement de l'histogramme ET ordre de la légende — le même. */
export const RUN_STATUS_ORDER: readonly AgentRunStatus[] = [
  'completed',
  'running',
  'needs-confirmation',
  'blocked',
  'failed',
] as const

export const RUN_STATUS_COLOR: Record<AgentRunStatus, string> = {
  completed: SEVERITY.good,
  running: SEVERITY.running,
  'needs-confirmation': SEVERITY.warn,
  blocked: SEVERITY.blocked,
  failed: SEVERITY.bad,
}

export const RUN_STATUS_LABEL: Record<AgentRunStatus, string> = {
  completed: 'Terminés',
  running: 'En cours',
  'needs-confirmation': 'À confirmer',
  blocked: 'Bloqués',
  failed: 'Échoués',
}

/** Forme singulière, pour une ligne de flux qui parle d'UN run. */
export const RUN_STATUS_SINGULAR: Record<AgentRunStatus, string> = {
  completed: 'Terminé',
  running: 'En cours',
  'needs-confirmation': 'À confirmer',
  blocked: 'Bloqué',
  failed: 'Échoué',
}

/** Statut d'un copilot — libellés seuls (la couleur voyage avec le Badge du kit). */
export const COPILOT_STATUS_LABEL: Record<string, string> = {
  active: 'Actif',
  paused: 'En pause',
  draft: 'Brouillon',
  degraded: 'Dégradé',
  archived: 'Archivé',
}
