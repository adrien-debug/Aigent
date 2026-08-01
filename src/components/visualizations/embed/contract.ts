/**
 * Contrat d'intégration des visualisations — AIGENT-VISUALIZATION-LAB-003.
 *
 * CE QU'AIGENT NE FAIT PAS. Il ne dessine aucune série, ne calcule aucune
 * métrique, ne restyle aucun graphique. Grafana reste propriétaire du rendu,
 * Prometheus des séries. Aigent possède l'ENVELOPPE : hiérarchie, titre,
 * provenance, état de vérité, action externe, responsive.
 *
 * POURQUOI UN CONTRAT PLUTÔT QU'UNE URL. Laisser un composant client passer une
 * URL arbitraire à une `<iframe>` ouvrirait un SSRF côté navigateur et rendrait
 * l'allowlist contournable. Ici, le client ne manipule que des IDENTIFIANTS
 * stables ; la résolution en URL se fait côté serveur, contre un registre figé.
 *
 * MODES : `grafana-panel` est le SEUL mode implémenté. Les autres valeurs de
 * `VisualizationSourceKind` existent pour que la frontière d'extension soit
 * lisible — elles ne sont pas supportées, et `resolveVisualization()` refuse de
 * les rendre. Un mode non implémenté ne peut jamais atteindre `READY`.
 */

/** Les six états de vérité. Ils ne sont pas interchangeables. */
export type VisualizationState =
  /** La requête est partie, la réponse n'est pas là. */
  | 'LOADING'
  /** La source est joignable, la liaison n'est pas encore établie. */
  | 'CONNECTING'
  /** Lecture réussie, mais aucune série ne correspond à la fenêtre. */
  | 'EMPTY'
  /** Aucune adresse configurée — rien n'a jamais été sondé. */
  | 'NOT_CONFIGURED'
  /** Adresse connue, source injoignable, refusée ou expirée. */
  | 'UNAVAILABLE'
  /** La visualisation source est rendue. */
  | 'READY'

/**
 * Modes d'intégration. Seul `grafana-panel` est implémenté.
 *
 * Les trois autres décrivent une frontière d'extension envisagée. Les déclarer
 * ici ne les rend PAS disponibles : `isImplementedKind()` est la seule autorité,
 * et l'adaptateur refuse tout mode qu'elle rejette.
 */
export type VisualizationSourceKind = 'grafana-panel' | 'iframe' | 'image-renderer' | 'vega-spec'

/** Les modes réellement implémentés et prouvés. */
const IMPLEMENTED_KINDS: readonly VisualizationSourceKind[] = ['grafana-panel']

export function isImplementedKind(kind: string): kind is VisualizationSourceKind {
  return (IMPLEMENTED_KINDS as readonly string[]).includes(kind)
}

/** Rôles sémantiques de surface — locaux à la visualisation, jamais globaux. */
export type SurfaceRole = 'base' | 'subtle' | 'raised' | 'interactive' | 'overlay'

/** Densité d'enveloppe, pour comparer deux traitements sans dupliquer le moteur. */
export type EnvelopeDensity = 'comfortable' | 'compact'

/** Déclaration d'une visualisation, telle qu'écrite dans le registre. */
export interface VisualizationDefinition {
  /** Identifiant stable — la SEULE chose qu'un client manipule. */
  id: string
  kind: VisualizationSourceKind
  title: string
  /** Ce que la visualisation montre, en français, pour un lecteur non technique. */
  description: string
  /** Identifiant du dashboard source. */
  dashboardUid: string
  /** Identifiant numérique du panneau dans ce dashboard. */
  panelId: number
  /** Provenance : d'où viennent les chiffres, jusqu'au producteur. */
  provenance: string
  /** Ratio hauteur/largeur du cadre. Un panneau écrasé perd ses axes. */
  aspectRatio: number
  /** Hauteur minimale en px — en deçà, légendes et tooltips sont coupés. */
  minHeightPx: number
  /** Fenêtre temporelle, au format Grafana. */
  timeFrom: string
}

/** Visualisation résolue côté serveur, prête à rendre. */
export interface ResolvedVisualization extends VisualizationDefinition {
  /** URL d'embed, construite par le serveur contre l'allowlist. Jamais du client. */
  embedUrl: string
  /** Lien d'ouverture dans l'outil source (dashboard complet). */
  sourceUrl: string
  state: VisualizationState
  /** Raison lisible quand l'état n'est pas `READY`. Jamais un secret. */
  reason: string | null
  /** Date de résolution, ISO. `null` si la source n'en fournit pas. */
  resolvedAt: string | null
}

/** Millisecondes au-delà desquelles une source est déclarée indisponible. */
export const VISUALIZATION_TIMEOUT_MS = 4_000

/**
 * Ce que l'UI a le droit de demander à Grafana en matière de thème.
 *
 * Restreint volontairement : le thème du CONTENU se règle DANS Grafana
 * (`GF_USERS_DEFAULT_THEME`). Aigent ne peut pas restyler une iframe
 * cross-origin, et prétendre le contraire produirait un habillage qui ment.
 */
export const ALLOWED_THEME_PARAMS = ['theme'] as const
export type AllowedThemeParam = (typeof ALLOWED_THEME_PARAMS)[number]
