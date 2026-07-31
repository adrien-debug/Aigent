/**
 * Mapping PUR : topologie LangGraph réelle → nœuds/arêtes XYFlow.
 *
 * CE MODULE NE DÉCIDE RIEN DU MÉTIER. Il ne lit pas le réseau, n'écrit rien, et
 * surtout n'INVENTE rien : `GraphTopology` ne transporte que `{id, label, type}`
 * par nœud, et c'est exactement ce qui ressort ici. Le rôle, le modèle, les
 * outils et les politiques d'un nœud ne sont PAS publiés par l'Agent Server
 * (`GET /assistants/{id}/graph` ne rend que la forme du graphe) : les afficher
 * exigerait de les fabriquer. Ils sont donc marqués absents dans l'inspecteur,
 * jamais devinés — `AGENTS.md` § Vérité des données.
 *
 * DISPOSITION CALCULÉE, PAS PERSISTÉE. Le placement vient d'un tri topologique
 * déterministe : même graphe → mêmes coordonnées, sans état stocké. C'est ce qui
 * permet à la disposition de rester « séparée des données métier » sans inventer
 * une table de layout : elle est dérivée, donc jamais désynchronisée du
 * manifeste. Le déplacement manuel d'un nœud vit dans l'état React du Canvas et
 * meurt avec lui — il ne touche jamais le graphe.
 */

/** Un nœud tel que l'explorateur LangGraph le publie. */
export interface TopologyNodeInput {
  id: string
  label: string
  type?: string
}

/** Une arête telle que l'explorateur LangGraph la publie. */
export interface TopologyEdgeInput {
  source: string
  target: string
  conditional?: boolean
}

/** Les deux extrémités conventionnelles d'un graphe LangGraph. */
const TERMINALS = new Set(['__start__', '__end__'])

/** Charge utile portée par un nœud du Canvas, consommée par l'inspecteur. */
export interface CanvasNodeData extends Record<string, unknown> {
  label: string
  nodeType: string | null
  terminal: boolean
  /** Nombre d'arêtes entrantes/sortantes — dérivé, donc toujours vrai. */
  inDegree: number
  outDegree: number
  /** Une arête conditionnelle part-elle de ce nœud ? */
  hasConditionalOut: boolean
}

export interface CanvasNode {
  id: string
  position: { x: number; y: number }
  data: CanvasNodeData
  type: 'aigentNode'
}

export interface CanvasEdge {
  id: string
  source: string
  target: string
  animated: boolean
  data: { conditional: boolean }
}

export interface CanvasGraph {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

/* ─────────────────────────── Disposition ─────────────────────────── */

/** Écartement vertical entre deux rangs. Une constante, pas un réglage. */
const RANK_GAP_Y = 120
/** Écartement horizontal entre deux nœuds d'un même rang. */
const SLOT_GAP_X = 220

/**
 * Range les nœuds par « profondeur depuis l'entrée » (BFS sur les arêtes).
 *
 * Un graphe LangGraph est orienté et peu profond : un BFS depuis `__start__`
 * (ou, à défaut, depuis les nœuds sans entrant) produit une lecture haut→bas
 * fidèle au flux d'exécution. Les nœuds injoignables ne sont pas perdus : ils
 * sont poussés dans un rang final, visibles et signalés par leur degré nul.
 */
function assignRanks(nodeIds: string[], edges: TopologyEdgeInput[]): Map<string, number> {
  const adjacency = new Map<string, string[]>()
  const inDegree = new Map<string, number>()
  for (const id of nodeIds) {
    adjacency.set(id, [])
    inDegree.set(id, 0)
  }
  for (const edge of edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue
    adjacency.get(edge.source)?.push(edge.target)
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
  }

  // Racines : `__start__` s'il existe, sinon tout nœud sans entrant. Un graphe
  // entièrement cyclique n'aurait ni l'un ni l'autre — on repart alors du
  // premier nœud pour ne jamais rendre une page vide sur un graphe non vide.
  let roots: string[] = nodeIds.filter((id) => id === '__start__')
  if (roots.length === 0) roots = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0)
  if (roots.length === 0 && nodeIds.length > 0) roots = [nodeIds[0]]

  const rank = new Map<string, number>()
  const queue: string[] = []
  for (const root of roots) {
    rank.set(root, 0)
    queue.push(root)
  }

  // BFS itératif — jamais récursif : un graphe cyclique ferait exploser la pile.
  let cursor = 0
  while (cursor < queue.length) {
    const current = queue[cursor]
    cursor += 1
    const currentRank = rank.get(current) ?? 0
    for (const next of adjacency.get(current) ?? []) {
      if (rank.has(next)) continue
      rank.set(next, currentRank + 1)
      queue.push(next)
    }
  }

  // Les injoignables (cycle isolé, nœud orphelin) atterrissent sous le reste.
  const maxRank = rank.size > 0 ? Math.max(...rank.values()) : 0
  for (const id of nodeIds) if (!rank.has(id)) rank.set(id, maxRank + 1)

  return rank
}

/**
 * Convertit une topologie réelle en graphe XYFlow.
 *
 * Tolère l'entrée dégradée sans jamais la maquiller : une arête qui pointe vers
 * un nœud inconnu est ÉCARTÉE (XYFlow rendrait une arête fantôme, donc un
 * graphe faux), et le nombre d'arêtes écartées est rendu à l'appelant pour
 * qu'il puisse le dire à l'écran plutôt que de le taire.
 */
export function toCanvasGraph(
  nodes: readonly TopologyNodeInput[],
  edges: readonly TopologyEdgeInput[],
): CanvasGraph & { droppedEdges: number } {
  // Dédoublonnage par id : deux nœuds de même id casseraient le rendu XYFlow.
  const byId = new Map<string, TopologyNodeInput>()
  for (const node of nodes) {
    if (node.id.length > 0 && !byId.has(node.id)) byId.set(node.id, node)
  }
  const ids = [...byId.keys()]

  const kept = edges.filter((e) => byId.has(e.source) && byId.has(e.target))
  const droppedEdges = edges.length - kept.length

  const rank = assignRanks(ids, kept)

  // Regroupement par rang, pour étaler horizontalement chaque rangée.
  const rows = new Map<number, string[]>()
  for (const id of ids) {
    const r = rank.get(id) ?? 0
    const row = rows.get(r)
    if (row) row.push(id)
    else rows.set(r, [id])
  }

  const outDegree = new Map<string, number>()
  const inDegreeFinal = new Map<string, number>()
  const conditionalOut = new Set<string>()
  for (const edge of kept) {
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1)
    inDegreeFinal.set(edge.target, (inDegreeFinal.get(edge.target) ?? 0) + 1)
    if (edge.conditional === true) conditionalOut.add(edge.source)
  }

  const canvasNodes: CanvasNode[] = []
  for (const [r, row] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    // Centrage de la rangée autour de x=0 : le graphe reste symétrique quel que
    // soit le nombre de nœuds, et `fitView` n'a pas de biais latéral.
    const offset = ((row.length - 1) * SLOT_GAP_X) / 2
    row.forEach((id, index) => {
      const source = byId.get(id)
      canvasNodes.push({
        id,
        type: 'aigentNode',
        position: { x: index * SLOT_GAP_X - offset, y: r * RANK_GAP_Y },
        data: {
          label: source?.label && source.label.length > 0 ? source.label : id,
          nodeType: source?.type && source.type.length > 0 ? source.type : null,
          terminal: TERMINALS.has(id),
          inDegree: inDegreeFinal.get(id) ?? 0,
          outDegree: outDegree.get(id) ?? 0,
          hasConditionalOut: conditionalOut.has(id),
        },
      })
    })
  }

  const canvasEdges: CanvasEdge[] = kept.map((edge, index) => ({
    // L'index désambiguïse deux arêtes parallèles entre les mêmes nœuds ;
    // sans lui, React les traiterait comme une seule.
    id: `${edge.source}->${edge.target}#${index}`,
    source: edge.source,
    target: edge.target,
    animated: edge.conditional === true,
    data: { conditional: edge.conditional === true },
  }))

  return { nodes: canvasNodes, edges: canvasEdges, droppedEdges }
}
