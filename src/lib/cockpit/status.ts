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
 * UNE SEULE TEINTE, DÉGRADÉE EN CLARTÉ. Le produit avait cinq teintes
 * distinctes (vert/bleu/ambre/violet/rouge) ; décision explicite d'Adrien
 * (2026-08-03) : un seul accent — celui de la marque, `--aig-accent`, teinte
 * OKLCH 52° — décliné en gravité croissante par assombrissement, jamais par
 * changement de teinte. C'est cohérent avec la note d'accessibilité
 * ci-dessous, qui était déjà vraie avant ce changement : la couleur seule n'a
 * jamais été le garde-fou, le libellé écrit l'est.
 *
 * ACCESSIBILITÉ — ce qui est vrai, et ce qui ne l'est pas. Une teinte unique
 * élimine par construction toute confusion inter-teinte (protan/deutan) —
 * l'ancienne promesse « ΔE ≥ 20 même en daltonisme » était fausse et n'a plus
 * lieu d'être : il n'y a plus qu'une teinte à confondre avec elle-même. La
 * distinction entre statuts adjacents reste portée par la clarté (l'écart est
 * calibré pour rester perceptible) et, TOUJOURS, par le libellé écrit. Ne
 * jamais coder un statut par la seule couleur.
 */
import type { AgentRunStatus } from '@/lib/agent-mission-control/types'

/**
 * Les cinq paliers de gravité du produit, et RIEN d'autre — la seule palette
 * de statut de tout le cockpit. Une seule teinte (52°, celle de
 * `--aig-accent`), déclinée du plus clair (`good`) au plus sombre (`bad`).
 * `RUN_STATUS_COLOR` et le `SEVERITY` consommé par `cockpit/primitives.tsx`
 * (jauges, rails de liste) en dérivent tous les deux : avant cette
 * réconciliation, les deux fichiers redéclaraient chacun une palette proche
 * mais pas identique (`#3d82ee` vs `#3b82f6` pour « en cours »), une dérive
 * qu'une deuxième source rend inévitable à terme.
 */
export const SEVERITY = {
  good: '#af6e45',
  running: '#aa5613',
  warn: '#983900',
  blocked: '#841d00',
  bad: '#700000',
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

