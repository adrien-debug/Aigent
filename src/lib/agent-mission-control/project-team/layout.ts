/**
 * Project team canvas — deterministic layout engine.
 *
 * PURE MODULE. No React, no DOM, no `Math.random`, no `Date.now`, no ambient
 * state. `computeTeamLayout(nodes, edges)` is a mathematical function: the same
 * input always produces the byte-identical output, which is what lets the
 * canvas re-run it freely (a status refresh recomputing the layout can never
 * move a node) and what makes it unit-testable without a renderer.
 *
 * ---------------------------------------------------------------------------
 * ALGORITHM — "clustered shelves around a centre"
 * ---------------------------------------------------------------------------
 * Layer 0  the single project node — the visual anchor/centre.
 * Layer 1  group nodes.
 * Layer 2  agent nodes, gridded under their own group, or gathered into one
 *          anonymous cluster around the project when they have no group.
 *
 * 1. CLUSTERING. Every group node opens a cluster. Agents are attached to a
 *    group through an explicit `team-membership` edge (either direction), and
 *    failing that through a `team` label matching a group's id/slug/name. An
 *    agent that matches nothing lands in the single anonymous cluster, which is
 *    always sorted first so it sits closest to the project node. An agent
 *    matching several groups keeps the lexicographically smallest group id, so
 *    the result never depends on edge order.
 *
 * 2. CLUSTER-LOCAL GRID. A cluster of n agents is laid out as a grid of
 *    `cols = clamp(round(sqrt(n * TARGET_ASPECT)), 1, AGENT_GRID_MAX_COLS)`
 *    columns — the sqrt keeps the block squarish, the target aspect widens it
 *    to ~16:10, the cap stops a 75-agent group from becoming a 40-column
 *    ribbon. The group node is centred above its grid. A partially-filled last
 *    row is centred (purely horizontal, so it cannot reduce the vertical gap).
 *    Cells are non-overlapping by construction: pitch = node size + gap.
 *
 * 3. CLUSTER PLACEMENT — the density switch (this is the documented
 *    orientation rule):
 *      • RADIAL — chosen when the cluster count is between `RING_MIN_CLUSTERS`
 *        and `RING_MAX_CLUSTERS` AND the required ring radius stays under
 *        `RING_MAX_RADIUS`. Clusters orbit the project node on one ring,
 *        sweeping clockwise from 12 o'clock; the project is the literal
 *        geometric centre and the aspect stays ~1:1. Fewer than
 *        `RING_MIN_CLUSTERS` is NOT a ring — see that constant for why.
 *      • TOP-DOWN — otherwise. Clusters are shelf-packed into rows whose
 *        target width is `sqrt(totalArea * TARGET_ASPECT)`, so the whole block
 *        converges on ~16:10 whatever the agent count; the project node is
 *        anchored above, horizontally centred on the block (still the visual
 *        centre of the composition, now on its axis of symmetry).
 *      • LEFT-RIGHT — the degenerate one-shelf case of the above: when every
 *        cluster fits on a single row, the flow reads horizontally. It is
 *        reported under its own name so the renderer/tests can tell the two
 *        apart, but it is the same packing pass.
 *
 * 4. NON-OVERLAP GUARANTEE. Every pair of node boxes is separated by at least
 *    `TEAM_LAYOUT.MIN_NODE_SEPARATION` px, edge to edge:
 *      - inside a grid           → AGENT_GAP_X / AGENT_GAP_Y (32)
 *      - group ↔ its agents      → GROUP_TO_AGENTS_GAP (48)
 *      - cluster ↔ cluster       → CLUSTER_GAP (64), enforced in radial mode on
 *                                  the clusters' circumscribed circles (a box is
 *                                  contained in its circle, so circle clearance
 *                                  implies box clearance) and in shelf mode by
 *                                  the row/column pitch
 *      - project ↔ everything    → CLUSTER_GAP or LAYER_GAP (≥64)
 *    Final coordinates are rounded to integers, which can shave at most 1px off
 *    a gap — still far above the 24px guarantee.
 *
 * 5. NOTHING IS EVER DROPPED. Any node the passes above did not place (an extra
 *    project node, an unknown `kind`) is appended to an "orphan" shelf below the
 *    composition rather than silently disappearing from the canvas.
 */

// ---------------------------------------------------------------------------
// Public constants — the renderer imports these so the drawn node size and the
// laid-out node size can never disagree.
// ---------------------------------------------------------------------------

/** Box size, in px, of each node kind. The canvas renders at exactly these. */
export const TEAM_NODE_SIZE = {
  project: { width: 264, height: 104 },
  group: { width: 208, height: 64 },
  agent: { width: 224, height: 96 },
} as const

export type TeamLayoutNodeKind = keyof typeof TEAM_NODE_SIZE

/** Spacing scale (all multiples of 8) + packing knobs. No magic numbers inline. */
export const TEAM_LAYOUT = {
  /** Guaranteed minimum edge-to-edge gap between ANY two node boxes. */
  MIN_NODE_SEPARATION: 24,
  /** Horizontal / vertical pitch gap inside a cluster's agent grid. */
  AGENT_GAP_X: 32,
  AGENT_GAP_Y: 32,
  /** Vertical gap between a group node and the top of its agent grid. */
  GROUP_TO_AGENTS_GAP: 48,
  /** Gap between two clusters' bounding boxes. */
  CLUSTER_GAP: 64,
  /** Gap between the project node and the layer below/around it. */
  LAYER_GAP: 96,
  /** Outer padding around the whole composition. */
  PADDING: 64,
  /** Hard cap on columns inside one cluster's agent grid. */
  AGENT_GRID_MAX_COLS: 8,
  /** Width/height ratio the packer converges on (16:10). */
  TARGET_ASPECT: 1.6,
  /**
   * Below this cluster count there is no ring to draw. One or two clusters on
   * a ring degenerate: the ring reserves each cluster's CIRCUMRADIUS in every
   * direction, which for the wide, flat boxes a cluster usually is wastes a
   * huge amount of space on the short axis (measured: 2 clusters came out at a
   * 4.5:1 aspect, 1 cluster at 0.5:1). Shelf packing places them with exactly
   * CLUSTER_GAP between boxes and the project centred above — tighter, and it
   * reads as the hierarchy it is.
   */
  RING_MIN_CLUSTERS: 3,
  /** Above this cluster count the radial ring is abandoned for shelves. */
  RING_MAX_CLUSTERS: 8,
  /** Above this ring radius the radial mode is abandoned for shelves. */
  RING_MAX_RADIUS: 2400,
} as const

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

/**
 * Structural subset of `ProjectTeamNode` this engine reads. Declared locally
 * (rather than imported) on purpose: the layout must stay a pure, dependency-
 * free function of geometry, and `ProjectTeamNode` is structurally assignable
 * to it. Status, metrics, tools and runs are deliberately ABSENT — they cannot
 * influence a position, which is what makes "a status change never moves a
 * node" a property of the algorithm rather than of a memo.
 */
export interface TeamLayoutInputNode {
  id: string
  kind: TeamLayoutNodeKind | string
  name?: string | null
  slug?: string | null
  team?: string | null
}

/** Structural subset of `ProjectTeamEdge` this engine reads. */
export interface TeamLayoutInputEdge {
  source: string
  target: string
  relation?: string | null
}

/** A placed node: TOP-LEFT corner + the size the renderer must draw. */
export interface TeamNodeBox {
  x: number
  y: number
  width: number
  height: number
}

export type TeamLayoutOrientation = 'radial' | 'top-down' | 'left-right'

export interface TeamLayoutResult {
  /** id → top-left box. Contains an entry for EVERY input node. */
  positions: Map<string, TeamNodeBox>
  /** Bounding box of the whole composition, padding included. */
  bounds: TeamNodeBox
  /** Which placement mode the density switch selected. */
  orientation: TeamLayoutOrientation
  /** Centre of the project node (or of the composition when there is none). */
  centre: { x: number; y: number }
}

export interface TeamLayoutOptions {
  /** Outer padding override, in px. Defaults to `TEAM_LAYOUT.PADDING`. */
  padding?: number
}

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

/**
 * Code-unit string comparison. Deliberately NOT `localeCompare`: that is
 * locale- and ICU-version-dependent, which would break byte-identical output
 * across machines.
 */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Stable sort key for a node: display name first, id as the unique tiebreak. */
function nodeSortKey(node: TeamLayoutInputNode): string {
  return `${node.name ?? ''} ${node.id}`
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function sizeOf(kind: string): { width: number; height: number } {
  return kind === 'project' || kind === 'group' || kind === 'agent'
    ? TEAM_NODE_SIZE[kind]
    : TEAM_NODE_SIZE.agent
}

/** Radius of the circle circumscribing a w×h box. */
function circumradius(width: number, height: number): number {
  return Math.sqrt(width * width + height * height) / 2
}

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

interface PlacedBox {
  id: string
  box: TeamNodeBox
}

interface Cluster {
  sortKey: string
  /** Local boxes, expressed from the cluster's own top-left corner (0,0). */
  boxes: PlacedBox[]
  width: number
  height: number
}

/**
 * Resolve agent → group. Explicit `team-membership` edges win (either
 * direction); the `team` label is the fallback, matched against a group's id,
 * slug or name. Several candidates → the lexicographically smallest group id,
 * so edge ordering can never change the result.
 */
function resolveAgentGroups(
  agents: readonly TeamLayoutInputNode[],
  groups: readonly TeamLayoutInputNode[],
  edges: readonly TeamLayoutInputEdge[]
): Map<string, string> {
  const groupIds = new Set(groups.map((g) => g.id))
  const agentIds = new Set(agents.map((a) => a.id))

  // group id keyed by every label that may designate it.
  const groupByLabel = new Map<string, string>()
  for (const group of [...groups].sort((a, b) => compareStrings(a.id, b.id))) {
    for (const label of [group.id, group.slug, group.name]) {
      if (!label) continue
      const key = label.toLowerCase()
      if (!groupByLabel.has(key)) groupByLabel.set(key, group.id)
    }
  }

  const explicit = new Map<string, string>()
  for (const edge of edges) {
    if (edge.relation !== 'team-membership') continue
    let agentId: string | null = null
    let groupId: string | null = null
    if (groupIds.has(edge.source) && agentIds.has(edge.target)) {
      groupId = edge.source
      agentId = edge.target
    } else if (groupIds.has(edge.target) && agentIds.has(edge.source)) {
      groupId = edge.target
      agentId = edge.source
    }
    if (!agentId || !groupId) continue
    const current = explicit.get(agentId)
    // Smallest group id wins → independent of edge order.
    if (current === undefined || compareStrings(groupId, current) < 0) {
      explicit.set(agentId, groupId)
    }
  }

  const resolved = new Map<string, string>()
  for (const agent of agents) {
    const fromEdge = explicit.get(agent.id)
    if (fromEdge) {
      resolved.set(agent.id, fromEdge)
      continue
    }
    const label = agent.team?.trim().toLowerCase()
    const fromLabel = label ? groupByLabel.get(label) : undefined
    if (fromLabel) resolved.set(agent.id, fromLabel)
  }
  return resolved
}

/**
 * Lay one cluster out locally: the group node centred above a grid of its
 * agents. Returns boxes in cluster-local coordinates (top-left = 0,0).
 */
function layoutCluster(
  group: TeamLayoutInputNode | null,
  agents: TeamLayoutInputNode[]
): { boxes: PlacedBox[]; width: number; height: number } {
  const { AGENT_GAP_X, AGENT_GAP_Y, GROUP_TO_AGENTS_GAP, AGENT_GRID_MAX_COLS, TARGET_ASPECT } = TEAM_LAYOUT
  const agentSize = TEAM_NODE_SIZE.agent
  const groupSize = TEAM_NODE_SIZE.group

  const n = agents.length
  const cols = n === 0 ? 0 : clamp(Math.round(Math.sqrt(n * TARGET_ASPECT)), 1, AGENT_GRID_MAX_COLS)
  const rows = n === 0 ? 0 : Math.ceil(n / cols)

  const gridWidth = n === 0 ? 0 : cols * agentSize.width + (cols - 1) * AGENT_GAP_X
  const gridHeight = n === 0 ? 0 : rows * agentSize.height + (rows - 1) * AGENT_GAP_Y

  const groupWidth = group ? groupSize.width : 0
  const groupHeight = group ? groupSize.height : 0
  const headerHeight = group && n > 0 ? groupHeight + GROUP_TO_AGENTS_GAP : groupHeight

  const width = Math.max(gridWidth, groupWidth)
  const height = headerHeight + gridHeight

  const boxes: PlacedBox[] = []
  if (group) {
    boxes.push({
      id: group.id,
      box: { x: (width - groupWidth) / 2, y: 0, width: groupWidth, height: groupHeight },
    })
  }

  const gridLeft = (width - gridWidth) / 2
  for (let index = 0; index < n; index += 1) {
    const row = Math.floor(index / cols)
    const col = index % cols
    // Centre a partially filled last row. Horizontal only — it can never
    // shorten the vertical gap between rows.
    const itemsInRow = Math.min(cols, n - row * cols)
    const rowWidth = itemsInRow * agentSize.width + (itemsInRow - 1) * AGENT_GAP_X
    const rowLeft = gridLeft + (gridWidth - rowWidth) / 2
    boxes.push({
      id: agents[index].id,
      box: {
        x: rowLeft + col * (agentSize.width + AGENT_GAP_X),
        y: headerHeight + row * (agentSize.height + AGENT_GAP_Y),
        width: agentSize.width,
        height: agentSize.height,
      },
    })
  }

  return { boxes, width, height }
}

/** Build every cluster, deterministically ordered (anonymous cluster first). */
function buildClusters(
  groups: readonly TeamLayoutInputNode[],
  agents: readonly TeamLayoutInputNode[],
  edges: readonly TeamLayoutInputEdge[]
): Cluster[] {
  const membership = resolveAgentGroups(agents, groups, edges)

  const byGroup = new Map<string, TeamLayoutInputNode[]>()
  const ungrouped: TeamLayoutInputNode[] = []
  for (const agent of [...agents].sort((a, b) => compareStrings(nodeSortKey(a), nodeSortKey(b)))) {
    const groupId = membership.get(agent.id)
    if (groupId === undefined) {
      ungrouped.push(agent)
      continue
    }
    const bucket = byGroup.get(groupId)
    if (bucket) bucket.push(agent)
    else byGroup.set(groupId, [agent])
  }

  const clusters: Cluster[] = []

  // ` ` sorts before every printable character → the anonymous cluster
  // (agents that answer directly to the project) is always placed first, i.e.
  // closest to the anchor.
  if (ungrouped.length > 0) {
    const laid = layoutCluster(null, ungrouped)
    clusters.push({ sortKey: ' ', ...laid })
  }

  for (const group of [...groups].sort((a, b) => compareStrings(nodeSortKey(a), nodeSortKey(b)))) {
    const laid = layoutCluster(group, byGroup.get(group.id) ?? [])
    clusters.push({ sortKey: `${nodeSortKey(group)}`, ...laid })
  }

  clusters.sort((a, b) => compareStrings(a.sortKey, b.sortKey))
  return clusters
}

// ---------------------------------------------------------------------------
// Cluster placement
// ---------------------------------------------------------------------------

/** Emit a cluster's boxes translated so its top-left lands on (originX, originY). */
function emitCluster(cluster: Cluster, originX: number, originY: number, out: Map<string, TeamNodeBox>): void {
  for (const placed of cluster.boxes) {
    out.set(placed.id, {
      x: originX + placed.box.x,
      y: originY + placed.box.y,
      width: placed.box.width,
      height: placed.box.height,
    })
  }
}

/**
 * Radial placement. Returns null when the density switch rejects it (too many
 * clusters, or a ring so wide it stops reading as one composition).
 */
function placeRadial(
  clusters: Cluster[],
  projectSize: { width: number; height: number },
  out: Map<string, TeamNodeBox>
): { centre: { x: number; y: number } } | null {
  const { CLUSTER_GAP, RING_MIN_CLUSTERS, RING_MAX_CLUSTERS, RING_MAX_RADIUS } = TEAM_LAYOUT
  const n = clusters.length
  if (n < RING_MIN_CLUSTERS || n > RING_MAX_CLUSTERS) return null

  const maxClusterRadius = Math.max(...clusters.map((c) => circumradius(c.width, c.height)))
  const projectRadius = circumradius(projectSize.width, projectSize.height)

  // Clear the anchor at the centre…
  let radius = projectRadius + maxClusterRadius + CLUSTER_GAP
  // …and keep neighbours on the ring apart: 2·R·sin(π/n) ≥ 2·maxR + gap.
  if (n > 1) {
    radius = Math.max(radius, (maxClusterRadius + CLUSTER_GAP / 2) / Math.sin(Math.PI / n))
  }
  if (radius > RING_MAX_RADIUS) return null

  // The project node itself is placed by the caller at the origin — the
  // literal geometric centre this ring was sized to clear. n ≥ 3 here
  // (RING_MIN_CLUSTERS), so a plain sweep from 12 o'clock is always balanced.
  for (let index = 0; index < n; index += 1) {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / n
    const centreX = radius * Math.cos(angle)
    const centreY = radius * Math.sin(angle)
    emitCluster(clusters[index], centreX - clusters[index].width / 2, centreY - clusters[index].height / 2, out)
  }

  return { centre: { x: 0, y: 0 } }
}

/**
 * Shelf packing. Clusters flow left-to-right into rows whose target width comes
 * from the total cluster area and the target aspect, so the block converges on
 * ~16:10 at any agent count. Returns the rows so the caller can tell a single
 * shelf (left-right reading) from a stack (top-down reading).
 */
function packShelves(clusters: Cluster[]): { rows: Cluster[][]; targetWidth: number } {
  const { CLUSTER_GAP, TARGET_ASPECT } = TEAM_LAYOUT
  const totalArea = clusters.reduce((sum, c) => sum + (c.width + CLUSTER_GAP) * (c.height + CLUSTER_GAP), 0)
  const widest = clusters.reduce((max, c) => Math.max(max, c.width), 0)
  const targetWidth = Math.max(widest, Math.sqrt(totalArea * TARGET_ASPECT))

  const rows: Cluster[][] = []
  let row: Cluster[] = []
  let rowWidth = 0
  for (const cluster of clusters) {
    const nextWidth = row.length === 0 ? cluster.width : rowWidth + CLUSTER_GAP + cluster.width
    if (row.length > 0 && nextWidth > targetWidth) {
      rows.push(row)
      row = [cluster]
      rowWidth = cluster.width
    } else {
      row.push(cluster)
      rowWidth = nextWidth
    }
  }
  if (row.length > 0) rows.push(row)
  return { rows, targetWidth }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Compute the position of every node of a project team graph.
 *
 * Deterministic and total: every input node gets exactly one box, and the same
 * input always yields the same output.
 */
export function computeTeamLayout(
  nodes: readonly TeamLayoutInputNode[],
  edges: readonly TeamLayoutInputEdge[] = [],
  options: TeamLayoutOptions = {}
): TeamLayoutResult {
  const { CLUSTER_GAP, LAYER_GAP } = TEAM_LAYOUT
  const padding = options.padding ?? TEAM_LAYOUT.PADDING

  const projects = nodes.filter((n) => n.kind === 'project')
  const groups = nodes.filter((n) => n.kind === 'group')
  const agents = nodes.filter((n) => n.kind === 'agent')

  // A single anchor. Extra project nodes (contract says there is one) are not
  // dropped — they join the orphan shelf below.
  const sortedProjects = [...projects].sort((a, b) => compareStrings(nodeSortKey(a), nodeSortKey(b)))
  const anchor = sortedProjects[0] ?? null
  const projectSize = anchor ? sizeOf(anchor.kind) : TEAM_NODE_SIZE.project

  const clusters = buildClusters(groups, agents, edges)
  const raw = new Map<string, TeamNodeBox>()

  let orientation: TeamLayoutOrientation
  let centre: { x: number; y: number }

  const radial = placeRadial(clusters, projectSize, raw)
  if (radial) {
    orientation = 'radial'
    centre = radial.centre
    if (anchor) {
      raw.set(anchor.id, {
        x: -projectSize.width / 2,
        y: -projectSize.height / 2,
        width: projectSize.width,
        height: projectSize.height,
      })
    }
  } else {
    const { rows } = packShelves(clusters)
    orientation = rows.length <= 1 ? 'left-right' : 'top-down'

    const rowWidths = rows.map((row) =>
      row.reduce((sum, c, i) => sum + c.width + (i === 0 ? 0 : CLUSTER_GAP), 0)
    )
    const blockWidth = rowWidths.reduce((max, w) => Math.max(max, w), 0)

    let y = 0
    rows.forEach((row, rowIndex) => {
      const rowHeight = row.reduce((max, c) => Math.max(max, c.height), 0)
      let x = (blockWidth - rowWidths[rowIndex]) / 2
      for (const cluster of row) {
        // Clusters of unequal height share a row: top-align them, the row
        // pitch already reserves the tallest one's height.
        emitCluster(cluster, x, y, raw)
        x += cluster.width + CLUSTER_GAP
      }
      y += rowHeight + CLUSTER_GAP
    })

    // Anchor above the block, on its axis of symmetry — still the visual centre.
    const blockCentreX = blockWidth / 2
    if (anchor) {
      raw.set(anchor.id, {
        x: blockCentreX - projectSize.width / 2,
        y: -(projectSize.height + LAYER_GAP),
        width: projectSize.width,
        height: projectSize.height,
      })
    }
    centre = { x: blockCentreX, y: anchor ? -(projectSize.height + LAYER_GAP) / 2 : 0 }
  }

  // Safety net: anything the passes above did not place (extra project nodes,
  // an unknown kind) goes on an orphan shelf under the composition. A node is
  // never silently missing from the canvas.
  const orphans = nodes
    .filter((n) => !raw.has(n.id))
    .sort((a, b) => compareStrings(nodeSortKey(a), nodeSortKey(b)))
  if (orphans.length > 0) {
    const bottom = raw.size === 0 ? 0 : Math.max(...[...raw.values()].map((b) => b.y + b.height))
    const left = raw.size === 0 ? 0 : Math.min(...[...raw.values()].map((b) => b.x))
    let x = left
    const shelfY = bottom + LAYER_GAP
    for (const orphan of orphans) {
      const size = sizeOf(orphan.kind)
      raw.set(orphan.id, { x, y: shelfY, width: size.width, height: size.height })
      x += size.width + CLUSTER_GAP
    }
  }

  // Normalise: translate so the composition starts at (padding, padding), and
  // round to integers for crisp rendering.
  const boxes = [...raw.values()]
  const minX = boxes.length === 0 ? 0 : Math.min(...boxes.map((b) => b.x))
  const minY = boxes.length === 0 ? 0 : Math.min(...boxes.map((b) => b.y))
  const dx = padding - minX
  const dy = padding - minY

  const positions = new Map<string, TeamNodeBox>()
  for (const node of nodes) {
    const box = raw.get(node.id)
    if (!box) continue
    positions.set(node.id, {
      x: Math.round(box.x + dx),
      y: Math.round(box.y + dy),
      width: box.width,
      height: box.height,
    })
  }

  const placed = [...positions.values()]
  const maxX = placed.length === 0 ? 0 : Math.max(...placed.map((b) => b.x + b.width))
  const maxY = placed.length === 0 ? 0 : Math.max(...placed.map((b) => b.y + b.height))

  return {
    positions,
    bounds: {
      x: 0,
      y: 0,
      width: placed.length === 0 ? padding * 2 : maxX + padding,
      height: placed.length === 0 ? padding * 2 : maxY + padding,
    },
    orientation,
    centre: { x: Math.round(centre.x + dx), y: Math.round(centre.y + dy) },
  }
}

/**
 * agentId → groupId, using the exact same resolution the layout itself applies
 * (explicit `team-membership` edge in either direction, then the `team` label).
 * Exported so the renderer can label a group with its agent count without
 * re-deriving membership by a second, possibly divergent rule.
 */
export function resolveTeamMembership(
  nodes: readonly TeamLayoutInputNode[],
  edges: readonly TeamLayoutInputEdge[]
): Map<string, string> {
  return resolveAgentGroups(
    nodes.filter((n) => n.kind === 'agent'),
    nodes.filter((n) => n.kind === 'group'),
    edges
  )
}

/**
 * Stable signature of the VISIBLE SET (ids, kinds, membership relations).
 *
 * The canvas keys its layout cache on this string: it changes when a node or a
 * membership edge appears/disappears, and NOT when a status, a metric or a run
 * is refreshed — which is why a status poll can never relayout the graph.
 */
export function teamLayoutSignature(
  nodes: readonly TeamLayoutInputNode[],
  edges: readonly TeamLayoutInputEdge[]
): string {
  const nodePart = nodes
    .map((n) => `${n.id}:${n.kind}:${n.team ?? ''}`)
    .sort(compareStrings)
    .join('|')
  const edgePart = edges
    .filter((e) => e.relation === 'team-membership' || e.relation === 'project-membership')
    .map((e) => `${e.source}>${e.target}:${e.relation}`)
    .sort(compareStrings)
    .join('|')
  return `${nodePart}#${edgePart}`
}
