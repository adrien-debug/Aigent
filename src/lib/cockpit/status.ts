/**
 * Vocabulaire de statut du cockpit — une seule définition pour l'écran ENTIER.
 *
 * POURQUOI DES VALEURS LITTÉRALES. Ces teintes sont consommées HORS de tout
 * contexte CSS : passées en props (`Rail color=`, `Led color=`, `BarMeter
 * color=`), écrites en attributs SVG et injectées dans des `style` inline. Un
 * `var(--…)` résoudrait au rendu mais pas partout où ces valeurs transitent en
 * JavaScript. Les garder ici, en dur et en UN SEUL endroit, est ce qui empêche
 * une puce de légende et sa barre de diverger silencieusement.
 *
 * (La mention d'un consommateur Recharts qui figurait ici était périmée :
 * Recharts n'est plus une dépendance du projet — ni dans `package.json`, ni
 * dans `node_modules`, ni importé nulle part. Le graphe d'activité est
 * aujourd'hui du SVG écrit à la main. La règle, elle, reste vraie pour la
 * raison ci-dessus ; c'est sa justification qui avait vieilli.)
 *
 * Un miroir CSS de ces cinq teintes existe dans `globals.css`
 * (`--aig-severity-*`) pour les encadrés d'alerte, qui sont du CSS pur. CE
 * FICHIER reste l'autorité : toute modification part d'ici.
 *
 * ACCESSIBILITÉ — ce qui est vrai, et ce qui ne l'est pas. Ces teintes tiennent
 * la bande de clarté OKLCH 0.48–0.67 et un chroma ≥ 0.1, et les paires
 * ADJACENTES dans l'ordre d'empilement se séparent nettement. Mais une
 * promesse de ΔE ≥ 20 « sur la pire paire, y compris en protan/deutan » a
 * figuré ici et elle était FAUSSE : en deutéranopie, `running` et `blocked` se
 * séparent d'un ΔE de l'ordre de 0,3 — indistinguables. Le garde-fou réel
 * n'est donc pas la couleur : c'est que chaque statut voyage TOUJOURS avec son
 * libellé écrit. Ne jamais coder un statut par la seule teinte.
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

