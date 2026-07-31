/**
 * Persistance de la DISPOSITION du Canvas — et rien d'autre.
 *
 * CE QUI EST STOCKÉ : des coordonnées. `{nodeId: {x, y}}` par `graphId`, plus le
 * cadrage. Rien de métier : aucun label, aucun type, aucune arête, aucun
 * identifiant d'assistant. Le manifeste LangGraph n'est NI lu NI écrit ici — la
 * disposition vit à côté des données, jamais dedans, exactement comme la mission
 * l'exige.
 *
 * POURQUOI `localStorage` ET PAS LA BASE : une disposition est une préférence de
 * lecture, propre à un opérateur et à son écran. La mettre en base la rendrait
 * globale — le déplacement d'un nœud par un opérateur bougerait l'écran de tous
 * les autres — et exigerait une écriture serveur sur une surface déclarée en
 * lecture seule. Le stockage client est le bon niveau, et il est cloisonné par
 * `graphId` pour que deux graphes ne se marchent pas dessus.
 *
 * TOLÉRANT À LA CORRUPTION. Tout ce qui sort du stockage est validé : un JSON
 * illisible, une clé étrangère, une coordonnée non finie ou un cadrage absurde
 * sont ÉCARTÉS silencieusement au profit de la disposition calculée. Une
 * disposition est un confort ; elle ne doit jamais pouvoir casser le rendu du
 * graphe, ni déplacer un nœud hors de portée.
 */

/** Une position persistée. */
export interface StoredPosition {
  x: number
  y: number
}

/** Ce qu'on garde pour un graphe donné. */
export interface StoredLayout {
  /** Positions par identifiant de nœud. */
  positions: Record<string, StoredPosition>
  /** Cadrage (zoom/pan), optionnel : absent = on laisse `fitView` décider. */
  viewport?: { x: number; y: number; zoom: number }
}

/** Préfixe de clé — versionné, pour pouvoir invalider un format futur. */
const KEY_PREFIX = 'aigent:canvas-layout:v1:'

/**
 * Bornes de sécurité. Une coordonnée hors de ces bornes viendrait d'un stockage
 * corrompu ou trafiqué ; l'accepter placerait un nœud à un endroit d'où
 * l'utilisateur ne pourrait plus le ramener.
 */
const MAX_COORD = 1_000_000
const MIN_ZOOM = 0.05
const MAX_ZOOM = 8

export function layoutKey(graphId: string): string {
  return `${KEY_PREFIX}${graphId}`
}

function finite(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit
}

/**
 * Valide une disposition venant du stockage. Retourne `null` si rien
 * d'exploitable — jamais un objet à moitié valide.
 */
export function parseLayout(raw: string | null): StoredLayout | null {
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // JSON illisible : on retombe sur la disposition calculée, sans bruit.
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as { positions?: unknown; viewport?: unknown }

  if (typeof candidate.positions !== 'object' || candidate.positions === null) return null

  const positions: Record<string, StoredPosition> = {}
  for (const [id, value] of Object.entries(candidate.positions as Record<string, unknown>)) {
    if (id.length === 0 || typeof value !== 'object' || value === null) continue
    const point = value as { x?: unknown; y?: unknown }
    // Une coordonnée non finie ou démesurée est écartée : elle enverrait le
    // nœud hors du monde visible, sans moyen de le récupérer.
    if (!finite(point.x, MAX_COORD) || !finite(point.y, MAX_COORD)) continue
    positions[id] = { x: point.x, y: point.y }
  }

  const layout: StoredLayout = { positions }

  const vp = candidate.viewport as { x?: unknown; y?: unknown; zoom?: unknown } | undefined
  if (
    vp &&
    finite(vp.x, MAX_COORD) &&
    finite(vp.y, MAX_COORD) &&
    typeof vp.zoom === 'number' &&
    Number.isFinite(vp.zoom) &&
    vp.zoom >= MIN_ZOOM &&
    vp.zoom <= MAX_ZOOM
  ) {
    layout.viewport = { x: vp.x, y: vp.y, zoom: vp.zoom }
  }

  return layout
}

/**
 * Applique une disposition persistée à des nœuds calculés.
 *
 * PUR, et volontairement conservateur : seule la POSITION est remplacée. Un
 * identifiant présent dans le stockage mais absent du graphe est ignoré — le
 * graphe fait autorité, jamais la disposition. Un nœud du graphe absent du
 * stockage garde sa position calculée : un graphe qui gagne un nœud reste
 * lisible sans réinitialisation.
 */
export function applyLayout<T extends { id: string; position: { x: number; y: number } }>(
  nodes: readonly T[],
  layout: StoredLayout | null,
): T[] {
  if (!layout) return [...nodes]
  return nodes.map((node) => {
    const stored = layout.positions[node.id]
    return stored ? { ...node, position: { x: stored.x, y: stored.y } } : node
  })
}

/** Extrait la disposition à persister depuis les nœuds courants. */
export function toStoredLayout<T extends { id: string; position: { x: number; y: number } }>(
  nodes: readonly T[],
  viewport?: { x: number; y: number; zoom: number },
): StoredLayout {
  const positions: Record<string, StoredPosition> = {}
  for (const node of nodes) positions[node.id] = { x: node.position.x, y: node.position.y }
  return viewport ? { positions, viewport } : { positions }
}

/* ─────────────────── Accès au stockage, tolérant aux pannes ─────────────── */

/**
 * `localStorage` peut lever : mode privé, quota plein, stockage désactivé par
 * politique. Aucune de ces situations ne doit casser l'affichage du graphe —
 * elles dégradent seulement la persistance, qui est un confort.
 */
export function readLayout(graphId: string): StoredLayout | null {
  if (typeof window === 'undefined') return null
  try {
    return parseLayout(window.localStorage.getItem(layoutKey(graphId)))
  } catch {
    return null
  }
}

export function writeLayout(graphId: string, layout: StoredLayout): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(layoutKey(graphId), JSON.stringify(layout))
  } catch {
    // Quota atteint ou stockage refusé : on abandonne la persistance en
    // silence. Alerter l'opérateur pour une préférence d'affichage serait
    // disproportionné.
  }
  bumpVersion()
}

export function clearLayout(graphId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(layoutKey(graphId))
  } catch {
    /* même raisonnement que `writeLayout`. */
  }
  bumpVersion()
}

/* ──────────────── Abonnement, pour `useSyncExternalStore` ──────────────── */

/**
 * Le pont entre `localStorage` et React.
 *
 * `useSyncExternalStore` exige un instantané STABLE : renvoyer un objet neuf à
 * chaque appel ferait boucler React à l'infini. On mémoïse donc le résultat par
 * clé, et on ne le recalcule qu'après une écriture — signalée par `version`.
 *
 * Ce détour évite un `setState` dans un effet (interdit par la règle
 * `react-hooks/set-state-in-effect`, et à raison : c'est un rendu de plus) tout
 * en gardant l'hydratation correcte, puisque l'instantané SERVEUR est `null`.
 */
let version = 0
const snapshots = new Map<string, { version: number; value: StoredLayout | null }>()
const listeners = new Set<() => void>()

function bumpVersion(): void {
  version += 1
  for (const listener of listeners) listener()
}

export function subscribeToLayout(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => void listeners.delete(onChange)
}

/** Instantané mémoïsé — même objet tant que rien n'a été écrit. */
export function readLayoutSnapshot(graphId: string): StoredLayout | null {
  const cached = snapshots.get(graphId)
  if (cached && cached.version === version) return cached.value
  const value = readLayout(graphId)
  snapshots.set(graphId, { version, value })
  return value
}
