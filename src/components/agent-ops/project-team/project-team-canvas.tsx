'use client'

import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react'
import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import '@xyflow/react/dist/style.css'

import {
  TEAM_NODE_SIZE,
  computeTeamLayout,
  resolveTeamMembership,
  teamLayoutSignature,
} from '@/lib/agent-mission-control/project-team/layout'
import type {
  ProjectTeamEdge,
  ProjectTeamGraph,
  ProjectTeamNode,
} from '@/lib/agent-mission-control/project-team/types'

import {
  ProjectTeamEdgeLine,
  isDirectedRelation,
  isMembershipRelation,
  type ProjectTeamEdgeEmphasis,
  type ProjectTeamFlowEdge,
} from './project-team-edge'
import {
  ProjectTeamNodeCard,
  type ProjectTeamFlowNode,
  type ProjectTeamNodeEmphasis,
} from './project-team-node'

/**
 * Project team canvas — the graph surface.
 *
 * PRESENTATIONAL. It fetches nothing, reads no URL, owns no filter logic: the
 * shell (Worker C) hands it a graph plus the current selection/view mode, and
 * gets clicks back. The accessible LIST alternative to this canvas also lives
 * in the shell — this file is the visual surface only.
 *
 * ── Why nodes never jump ────────────────────────────────────────────────────
 * The layout is a pure function of the VISIBLE SET (ids, kinds, membership),
 * and `teamLayoutSignature` hashes exactly that — no status, no metric, no run.
 * Two consequences, both deliberate:
 *   1. The layout is recomputed only when a node or a membership edge actually
 *      enters or leaves the canvas (cached below on the signature).
 *   2. Even if it WERE recomputed on every poll, the result would be identical,
 *      because `computeTeamLayout` cannot see a status. A status refresh
 *      physically cannot move a node.
 *
 * ── Motion budget ───────────────────────────────────────────────────────────
 * At rest NOTHING animates: no idle pulse, no permanent flow. The only moving
 * parts are (a) an edge carrying real recent traffic while the `activity` view
 * is on, and (b) the spinner/pulse on an agent whose run is genuinely running.
 * All of it is cancelled by `prefers-reduced-motion` in the stylesheet below,
 * in CSS rather than JS, so the browser stops the animation outright instead of
 * React unmounting it — and every animated fact is ALSO carried statically
 * (stroke weight, dash pattern, an explicit text label).
 */

export type ProjectTeamViewMode = 'structure' | 'activity' | 'dependencies'

export interface ProjectTeamCanvasProps {
  graph: ProjectTeamGraph
  /** Currently selected node id (agent, group or project). `null` = nothing selected. */
  selectedAgentId?: string | null
  /** Selection callback. Receives `null` when the empty canvas is clicked. */
  onSelectAgent?: (nodeId: string | null) => void
  /** Changes VISUAL PRIORITY only. It never adds, removes or edits data. */
  viewMode?: ProjectTeamViewMode
  /**
   * The shell's filter result: ids allowed on the canvas. `undefined`/`null`
   * means "no filter". The project anchor is always kept so the composition
   * never loses its centre.
   */
  filteredNodeIds?: readonly string[] | null
  /**
   * Reports whether this canvas is actually DRAWING the graph.
   *
   * `true` only once the viewport has been fitted against a container with a
   * real measured size AND there is at least one node in the visible set —
   * i.e. the two conditions under which a node can be on screen. It is not a
   * guess and not a timer: it is the canvas answering for its own paint, so a
   * shell can offer a real fallback instead of an empty rectangle (see the
   * accessible list in project-team-view.tsx).
   *
   * MUST be reference-stable (a `useState` setter, or `useCallback`) — it is an
   * effect dependency here.
   */
  onPaintedChange?: (painted: boolean) => void
  className?: string
}

// ---------------------------------------------------------------------------
// Module-level type maps. MUST NOT be inline object literals: React Flow
// compares them by reference and warns + re-renders the whole graph when a new
// object arrives on every render.
// ---------------------------------------------------------------------------

const nodeTypes: NodeTypes = { 'team-node': ProjectTeamNodeCard }
const edgeTypes: EdgeTypes = { 'team-edge': ProjectTeamEdgeLine }

// `maxZoom` caps how far fitView may scale a graph UP. Left at 1, a small team
// (5-10 agents) stayed pinned at its authored size and floated in a mostly
// empty canvas — the graph must be allowed to grow into the surface it was
// given. 1.35 fills the viewport for small rosters while staying under the 1.6
// interactive ceiling, so fitView never lands on a zoom you cannot zoom past.
const FIT_VIEW_OPTIONS = { padding: 0.12, maxZoom: 1.35 } as const
const PRO_OPTIONS = { hideAttribution: false } as const

// ---------------------------------------------------------------------------
// Layout memo, keyed on the visible-set signature.
//
// `computeTeamLayout` is deterministic, so this cache is a pure memoization: a
// hit is indistinguishable from a recomputation, which makes it safe under
// concurrent rendering. It lives here rather than in `layout.ts` so that module
// stays a pure, stateless function.
//
// What it buys: the graph object is REPLACED on every status poll, so a plain
// `useMemo([nodes, edges])` would hand React Flow a brand-new position object
// for every node on every refresh even though the numbers are identical. Keying
// on the signature — which contains ids, kinds and membership, and no status —
// keeps those objects reference-stable, so a status refresh re-renders nodes
// without touching the geometry.
// ---------------------------------------------------------------------------

const LAYOUT_CACHE_MAX = 8
const layoutCache = new Map<string, ReturnType<typeof computeTeamLayout>>()

function cachedTeamLayout(
  key: string,
  nodes: readonly ProjectTeamNode[],
  edges: readonly ProjectTeamEdge[]
): ReturnType<typeof computeTeamLayout> {
  const hit = layoutCache.get(key)
  if (hit) return hit
  const value = computeTeamLayout(nodes, edges)
  layoutCache.set(key, value)
  if (layoutCache.size > LAYOUT_CACHE_MAX) {
    const oldest = layoutCache.keys().next()
    if (!oldest.done) layoutCache.delete(oldest.value)
  }
  return value
}

/** Scoped stylesheet: canvas chrome + every keyframe, with the motion opt-out. */
const CANVAS_STYLES = `
.ptc-canvas .react-flow__attribution { display: none; }
/* Hidden edge anchors — the custom edge computes floating geometry from node
   centres, these exist only so React Flow can attach an edge. */
.ptc-canvas .ptc-anchor { opacity: 0; pointer-events: none; width: 1px; height: 1px; min-width: 0; min-height: 0; border: 0; }
.ptc-canvas .react-flow__node { cursor: default; }
.ptc-canvas .react-flow__edge { pointer-events: none; }

/* Minimap: an active agent reads as a heavier, lighter STROKE — never as a hue
   of its own. The minimap is a navigation aid; the canvas node carries the
   authoritative icon + border style + text label for the status. */
.ptc-canvas .react-flow__minimap-node.ptc-mini-active { stroke: var(--color-zinc-300); stroke-width: 5; }

/* The built-in Controls are viewport plumbing for the toolbar, never shown. */
.ptc-canvas .ptc-hidden-controls { display: none; }

/* Chrome (Controls / MiniMap) on the app's own surfaces — zinc only. */
.ptc-canvas .react-flow__controls { box-shadow: none; border-radius: 0.75rem; overflow: hidden; border: 1px solid var(--color-hairline); }
.ptc-canvas .react-flow__controls-button { background: var(--color-surface-overlay); border-bottom: 1px solid var(--color-hairline); fill: var(--color-zinc-400); }
.ptc-canvas .react-flow__controls-button:hover { background: var(--color-surface-overlay); fill: var(--color-zinc-200); }
.ptc-canvas .react-flow__minimap { background: var(--color-surface-sunken); border: 1px solid var(--color-hairline); border-radius: 0.75rem; }

/* A derived edge is dashed at rest: a computed guess must never read as configured. */
.ptc-canvas .ptc-derived { stroke-dasharray: 4 4; }

/* MOTION — only these three, only when the data earns them. */
.ptc-canvas .ptc-flow { stroke-dasharray: 6 8; animation: ptc-dash 1.4s linear infinite; }
.ptc-pulse { animation: ptc-pulse 2.4s ease-in-out infinite; }
.ptc-spin { animation: ptc-spin 1.8s linear infinite; }
@keyframes ptc-dash { to { stroke-dashoffset: -28; } }
@keyframes ptc-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@keyframes ptc-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  /* No motion at all. The facts survive: .ptc-flow keeps its dash pattern and
     its heavier accent stroke, and the agent's status label is always text. */
  .ptc-canvas .ptc-flow, .ptc-pulse, .ptc-spin { animation: none; }
  .ptc-canvas .react-flow__edge path, .ptc-canvas .react-flow__node { transition: none; }
}
`

// ---------------------------------------------------------------------------
// Emphasis rules
// ---------------------------------------------------------------------------

/**
 * Edge priority per view mode. This is the ONLY thing `viewMode` touches —
 * no edge is added, removed or relabelled, only pushed forward or back.
 */
function edgeEmphasisForViewMode(edge: ProjectTeamEdge, viewMode: ProjectTeamViewMode): ProjectTeamEdgeEmphasis {
  const membership = isMembershipRelation(edge.relation)
  if (viewMode === 'structure') return membership ? 'prominent' : 'faint'
  if (viewMode === 'dependencies') return membership ? 'faint' : 'prominent'
  // activity: real traffic first, structure kept legible behind it.
  if (edge.active) return 'prominent'
  return membership ? 'normal' : 'faint'
}

/**
 * Minimap predicate. React Flow hands the minimap a bare `Node`, so this narrows
 * it before reading our own payload — a foreign node type simply reads as
 * not-active rather than throwing.
 */
function isActiveTeamNode(node: { type?: string }): boolean {
  return node.type === 'team-node' && (node as ProjectTeamFlowNode).data?.node.status === 'active'
}

// ---------------------------------------------------------------------------
// Inner canvas (inside the provider, so it can drive the viewport)
// ---------------------------------------------------------------------------

function ProjectTeamCanvasInner({
  graph,
  selectedAgentId = null,
  onSelectAgent,
  viewMode = 'structure',
  filteredNodeIds = null,
  onPaintedChange,
  className,
}: ProjectTeamCanvasProps) {
  const { fitView } = useReactFlow()
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [viewportFitted, setViewportFitted] = useState(false)

  // -- Visible set ----------------------------------------------------------
  // A filter genuinely changes what exists on the canvas (unlike selection,
  // which only dims). The anchor is always kept: without it the composition
  // has no centre.
  const { visibleNodes, visibleEdges } = useMemo(() => {
    if (!filteredNodeIds) return { visibleNodes: graph.nodes, visibleEdges: graph.edges }
    const allowed = new Set(filteredNodeIds)
    for (const node of graph.nodes) if (node.kind === 'project') allowed.add(node.id)
    const nodes = graph.nodes.filter((n) => allowed.has(n.id))
    const edges = graph.edges.filter((e) => allowed.has(e.source) && allowed.has(e.target))
    return { visibleNodes: nodes, visibleEdges: edges }
  }, [graph.nodes, graph.edges, filteredNodeIds])

  const layoutKey = useMemo(
    () => teamLayoutSignature(visibleNodes, visibleEdges),
    [visibleNodes, visibleEdges]
  )

  // -- Layout, cached on the visible-set signature --------------------------
  // See `cachedTeamLayout` above: the signature carries ids/kinds/membership
  // and NO status, so this only ever recomputes when the visible set really
  // changed — and even a forced recompute would return identical coordinates.
  const layout = useMemo(
    () => cachedTeamLayout(layoutKey, visibleNodes, visibleEdges),
    [layoutKey, visibleNodes, visibleEdges]
  )

  // Group sizes come from the layout's OWN membership resolver, so a group's
  // headcount can never disagree with what is drawn under it.
  const memberCounts = useMemo(() => {
    const membership = resolveTeamMembership(visibleNodes, visibleEdges)
    const counts = new Map<string, number>()
    for (const groupId of membership.values()) counts.set(groupId, (counts.get(groupId) ?? 0) + 1)
    return counts
  }, [visibleNodes, visibleEdges])

  const agentCount = useMemo(
    () => visibleNodes.filter((n) => n.kind === 'agent').length,
    [visibleNodes]
  )

  // -- Selection neighbourhood ---------------------------------------------
  const neighbourIds = useMemo(() => {
    if (!selectedAgentId) return null
    const ids = new Set<string>([selectedAgentId])
    for (const edge of visibleEdges) {
      if (edge.source === selectedAgentId) ids.add(edge.target)
      else if (edge.target === selectedAgentId) ids.add(edge.source)
    }
    return ids
  }, [selectedAgentId, visibleEdges])

  const handleSelect = useCallback(
    (nodeId: string) => {
      onSelectAgent?.(nodeId === selectedAgentId ? null : nodeId)
    },
    [onSelectAgent, selectedAgentId]
  )

  // -- React Flow nodes -----------------------------------------------------
  const flowNodes = useMemo<ProjectTeamFlowNode[]>(() => {
    return visibleNodes.map((node: ProjectTeamNode) => {
      const position = layout.positions.get(node.id) ?? { x: 0, y: 0 }
      const size = TEAM_NODE_SIZE[node.kind]
      const emphasis: ProjectTeamNodeEmphasis =
        neighbourIds === null
          ? 'primary'
          : node.id === selectedAgentId
            ? 'primary'
            : neighbourIds.has(node.id)
              ? 'neighbour'
              : 'muted'

      return {
        id: node.id,
        type: 'team-node',
        position: { x: position.x, y: position.y },
        // Explicit dimensions: the floating edge geometry is then correct on
        // the very first paint, before React Flow's measure pass.
        width: size.width,
        height: size.height,
        draggable: false,
        selectable: false,
        // The node's own Headless.Button is the focus target — letting React
        // Flow focus the wrapper too would create two tab stops per node.
        focusable: false,
        data: {
          node,
          emphasis,
          isSelected: node.id === selectedAgentId,
          memberCount:
            node.kind === 'group'
              ? (memberCounts.get(node.id) ?? 0)
              : node.kind === 'project'
                ? agentCount
                : null,
          onSelect: onSelectAgent ? handleSelect : null,
        },
      }
    })
  }, [
    visibleNodes,
    layout,
    neighbourIds,
    selectedAgentId,
    memberCounts,
    agentCount,
    onSelectAgent,
    handleSelect,
  ])

  // -- React Flow edges -----------------------------------------------------
  const flowEdges = useMemo<ProjectTeamFlowEdge[]>(() => {
    return visibleEdges.map((edge: ProjectTeamEdge) => {
      const touchesSelection =
        selectedAgentId !== null && (edge.source === selectedAgentId || edge.target === selectedAgentId)

      // Selection wins over the view mode: the point of selecting a node is to
      // read ITS relations. Everything else recedes, nothing is removed.
      const emphasis: ProjectTeamEdgeEmphasis =
        selectedAgentId === null
          ? edgeEmphasisForViewMode(edge, viewMode)
          : touchesSelection
            ? 'prominent'
            : 'faint'

      // Motion is earned, not decorative: activity view + REAL recent traffic +
      // a relation that actually describes a flow.
      const animateFlow = viewMode === 'activity' && edge.active && isDirectedRelation(edge.relation)

      return {
        id: edge.id,
        type: 'team-edge',
        source: edge.source,
        target: edge.target,
        selectable: false,
        focusable: false,
        markerEnd: isDirectedRelation(edge.relation)
          ? {
              type: MarkerType.ArrowClosed,
              width: 14,
              height: 14,
              color: edge.active ? 'var(--color-accent-400)' : 'var(--color-zinc-500)',
            }
          : undefined,
        data: {
          relation: edge.relation,
          origin: edge.origin,
          label: edge.label,
          emphasis,
          active: edge.active,
          animateFlow,
          showLabel: hoveredEdgeId === edge.id || (touchesSelection && emphasis === 'prominent'),
        },
      }
    })
  }, [visibleEdges, selectedAgentId, viewMode, hoveredEdgeId])

  // -- Viewport -------------------------------------------------------------
  // Refit only when the composition itself changed, and only ONCE the container
  // has a real measured size.
  //
  // The size gate is the whole fix. This canvas sits at the bottom of a
  // `min-h-0 flex-1` chain, so on first paint its box is still 0-high when the
  // effect runs; a `requestAnimationFrame(fitView)` therefore fitted against an
  // empty rectangle and parked the viewport transform outside the box that
  // appeared a frame later. Measured symptom: a 1096×388 canvas showing
  // NOTHING while the DOM held five `.react-flow__node` elements and a minimap
  // — the nodes existed, the camera was pointed away from them. No delay
  // constant fixes that honestly; the only correct trigger is the real
  // measurement, which is what `ResizeObserver` reports.
  //
  // The observer disconnects on its first usable box, so a later window resize
  // does NOT refit: the camera must never move under a user who is reading the
  // graph. A composition change re-runs the effect and arms a fresh observer,
  // which is exactly the old contract (a status refresh, a selection or a
  // view-mode switch do not touch `layoutKey`, so none of them refits).
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    setViewportFitted(false)

    let frame = 0
    let done = false
    const observer = new ResizeObserver((entries) => {
      if (done) return
      const box = entries[entries.length - 1]?.contentRect
      if (!box || box.width < 1 || box.height < 1) return
      done = true
      observer.disconnect()
      // Still a frame late, deliberately: React Flow reads the pane size from
      // the DOM, so the fit has to land after the browser has laid out the box
      // the observer just told us about.
      frame = requestAnimationFrame(() => {
        fitView(FIT_VIEW_OPTIONS)
        setViewportFitted(true)
      })
    })
    observer.observe(container)
    return () => {
      done = true
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [layoutKey, fitView])

  // What the shell needs to know: a fitted viewport over a non-empty visible
  // set is the only state in which a node can actually be on screen. Reported,
  // never inferred by the shell from a timer or a DOM probe.
  const painted = viewportFitted && visibleNodes.length > 0
  useEffect(() => {
    onPaintedChange?.(painted)
  }, [painted, onPaintedChange])

  const onEdgeMouseEnter = useCallback(
    (_event: React.MouseEvent, edge: ProjectTeamFlowEdge) => setHoveredEdgeId(edge.id),
    []
  )
  const onEdgeMouseLeave = useCallback(() => setHoveredEdgeId(null), [])
  const onPaneClick = useCallback(() => onSelectAgent?.(null), [onSelectAgent])

  return (
    <div
      ref={containerRef}
      className={clsx(
        // Bounded box: the canvas zooms and pans INSIDE itself and can never
        // push the page body into a horizontal scroll.
        'ptc-canvas relative h-full w-full max-w-full overflow-hidden rounded-xl',
        className
      )}
    >
      <style>{CANVAS_STYLES}</style>
      <ReactFlow<ProjectTeamFlowNode, ProjectTeamFlowEdge>
        aria-label={`Team graph for ${graph.project.name}: ${agentCount} agents, ${visibleEdges.length} relations`}
        aria-roledescription="interactive team graph"
        colorMode="dark"
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onPaneClick={onPaneClick}
        onEdgeMouseEnter={onEdgeMouseEnter}
        onEdgeMouseLeave={onEdgeMouseLeave}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        // Keeps the DOM small on large rosters; nodes outside the viewport are
        // not mounted at all.
        onlyRenderVisibleElements
        minZoom={0.08}
        maxZoom={1.6}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        proOptions={PRO_OPTIONS}
        panOnScroll
        zoomOnDoubleClick={false}
        // The canvas must not swallow the page's scroll gesture; zoom is on
        // ctrl/cmd + wheel, pan is on plain wheel.
        preventScrolling={false}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={28}
          size={1}
          color="var(--color-zinc-800)"
          bgColor="var(--color-surface-primary)"
        />
        {/* Kept MOUNTED but fully hidden. Two visible zoom widgets on one canvas
            is a duplicate control, and the toolbar's set is the accessible one
            (labelled, in the tab order, outside the provider). These buttons are
            the real viewport plumbing that toolbar drives — it resolves and
            `.click()`s them — so they must stay in the DOM. `display:none` keeps
            `.click()` working while removing them from BOTH the tab order and
            the a11y tree, so a screen-reader user is not offered the same four
            controls twice. */}
        <Controls showInteractive={false} position="bottom-right" className="ptc-hidden-controls" />
        <MiniMap
          pannable
          zoomable
          // Purely a navigation aid: it duplicates nodes that already carry an
          // icon + border style + text label on the canvas itself, so it is
          // deliberately NOT a status surface. Active nodes get a heavier
          // stroke rather than a colour of their own — status here would
          // otherwise ride on hue alone, which the doctrine forbids, and the
          // minimap is far too small to render a legible label.
          ariaLabel="Team graph minimap — navigation only, agent status is on the canvas"
          position="bottom-left"
          maskColor="var(--color-minimap-mask)"
          nodeStrokeWidth={2}
          nodeColor="var(--color-zinc-600)"
          nodeStrokeColor="var(--color-zinc-700)"
          // Active nodes are marked by STROKE, not hue — see .ptc-mini-active.
          nodeClassName={(node) => (isActiveTeamNode(node) ? 'ptc-mini-active' : '')}
        />
      </ReactFlow>
    </div>
  )
}

/**
 * Public canvas. The provider wrapper is what lets the inner component drive
 * the viewport (`useReactFlow`) while staying a single import for the shell.
 */
export function ProjectTeamCanvas(props: ProjectTeamCanvasProps) {
  return (
    <ReactFlowProvider>
      <ProjectTeamCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
