'use client'

import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  useInternalNode,
  type Edge,
  type EdgeProps,
  type InternalNode,
  type Node,
} from '@xyflow/react'
import clsx from 'clsx'
import { memo, useState } from 'react'

import type {
  ProjectTeamEdgeOrigin,
  ProjectTeamEdgeRelation,
} from '@/lib/agent-mission-control/project-team/types'

/**
 * Project team canvas — edge renderer.
 *
 * Thin, low-contrast curves at rest; the label only appears on hover or when
 * the edge is prominent. Two hard rules encoded here:
 *
 *  1. DIRECTION MARKERS ONLY ON DIRECTED RELATIONS. Membership ("this agent is
 *     part of this team") is not a flow, so it gets no arrowhead. Putting one
 *     there would invent a direction the data never claimed.
 *
 *  2. DERIVED ≠ EXPLICIT. A derived edge (shared tool names, mission
 *     participation) is DASHED; an explicit one (a persisted relation row, or
 *     membership) is SOLID. The UI must never let a computed guess look like
 *     something an operator configured.
 *
 * MOTION: an edge animates only when ALL of viewMode === 'activity', the edge
 * carries real recent activity (`active`), and the relation is directed traffic
 * — and never under `prefers-reduced-motion`, which is enforced in pure CSS by
 * the canvas stylesheet (`.ptc-flow` keyframes are cancelled by the media
 * query, so the browser stops the animation outright rather than JS unmounting
 * it). The same fact is ALSO carried statically by a heavier stroke and full
 * opacity, so nothing is lost when motion is off. At rest, no edge animates:
 * CPU is idle when nothing is happening.
 */

// ---------------------------------------------------------------------------
// Relation semantics
// ---------------------------------------------------------------------------

/** Structural relations: who belongs to whom. Undirected — no arrowhead. */
const MEMBERSHIP_RELATIONS: ReadonlySet<ProjectTeamEdgeRelation> = new Set([
  'project-membership',
  'team-membership',
])

/**
 * Relations that describe a flow between two agents. These are the ones that
 * earn an arrowhead, and the ones the `dependencies` view promotes.
 */
const DIRECTED_RELATIONS: ReadonlySet<ProjectTeamEdgeRelation> = new Set([
  'orchestrates',
  'depends-on',
  'sends-output-to',
  'reviews',
  'triggers',
])

export function isMembershipRelation(relation: ProjectTeamEdgeRelation): boolean {
  return MEMBERSHIP_RELATIONS.has(relation)
}

export function isDirectedRelation(relation: ProjectTeamEdgeRelation): boolean {
  return DIRECTED_RELATIONS.has(relation)
}

/**
 * Human label per relation, canvas phrasing — lowercase fragment, used in the
 * edge hover label and the a11y description of the graph.
 *
 * Single source of truth for `ProjectTeamEdgeRelation` → label: the panel
 * (`project-team-panel.tsx`) needs a differently-cased, sentence-style phrasing
 * for its relation rows ("Member of project" vs this file's "in project") — see
 * `RELATION_SENTENCE_LABEL` below, re-exported from here so both presentations
 * of the same enum live in one file instead of drifting apart in two.
 */
const RELATION_LABEL: Record<ProjectTeamEdgeRelation, string> = {
  'project-membership': 'in project',
  'team-membership': 'in team',
  orchestrates: 'orchestrates',
  'depends-on': 'depends on',
  'sends-output-to': 'sends output to',
  reviews: 'reviews',
  triggers: 'triggers',
  'shares-tool': 'shares tools',
}

/** Human label per relation, panel phrasing — sentence-style, used in the relation-row description and delete confirmation. */
export const RELATION_SENTENCE_LABEL: Record<ProjectTeamEdgeRelation, string> = {
  'project-membership': 'Member of project',
  'team-membership': 'Member of team',
  orchestrates: 'Orchestrates',
  'depends-on': 'Depends on',
  'sends-output-to': 'Sends output to',
  reviews: 'Reviews',
  triggers: 'Triggers',
  'shares-tool': 'Shares a tool with',
}

/** How prominent this edge is under the current view mode / selection. */
export type ProjectTeamEdgeEmphasis = 'prominent' | 'normal' | 'faint'

export type ProjectTeamEdgeData = {
  relation: ProjectTeamEdgeRelation
  origin: ProjectTeamEdgeOrigin
  label: string | null
  emphasis: ProjectTeamEdgeEmphasis
  /** Real recent traffic (from the contract), NOT a decoration. */
  active: boolean
  /** Animate: viewMode === 'activity' AND active AND a directed relation. */
  animateFlow: boolean
  /**
   * Show the label WITHOUT hovering (selected / prominent edges).
   *
   * Hover is deliberately NOT part of this: it is per-edge local state inside
   * the renderer. Threading a `hoveredEdgeId` through the shared edge array
   * meant hovering ANY edge rebuilt the whole array with fresh `data` objects,
   * which defeated `memo` here and re-rendered EVERY edge at mousemove rate.
   */
  showLabel: boolean
}

/**
 * Invisible hit area. The rendered curve is 1-1.75px wide — unhittable in
 * practice — and the canvas stylesheet sets `pointer-events: none` on the whole
 * `.react-flow__edge` group. A descendant may re-enable hit testing for itself,
 * so this transparent fat stroke is the edge's only interactive surface.
 * `stroke` (not `visibleStroke`) responds regardless of paint, so a transparent
 * stroke still receives the pointer.
 */
const HOVER_HIT_WIDTH = 14

export type ProjectTeamFlowEdge = Edge<ProjectTeamEdgeData, 'team-edge'>

// ---------------------------------------------------------------------------
// Floating geometry — the layout is radial, so edges must leave a node at the
// angle that actually points at the other node, not at a fixed handle.
// ---------------------------------------------------------------------------

interface Circleish {
  cx: number
  cy: number
  width: number
  height: number
}

function boxOf(node: InternalNode<Node> | undefined): Circleish | null {
  if (!node) return null
  const width = node.measured?.width ?? node.width ?? 0
  const height = node.measured?.height ?? node.height ?? 0
  if (width === 0 || height === 0) return null
  return {
    cx: node.internals.positionAbsolute.x + width / 2,
    cy: node.internals.positionAbsolute.y + height / 2,
    width,
    height,
  }
}

/**
 * Point where the segment from `from` centre to `to` centre crosses `from`'s
 * rectangle border. Standard box/ray intersection: scale the direction vector
 * by whichever axis hits its half-extent first.
 */
function borderPoint(from: Circleish, to: Circleish): { x: number; y: number; position: Position } {
  const dx = to.cx - from.cx
  const dy = to.cy - from.cy
  if (dx === 0 && dy === 0) {
    return { x: from.cx, y: from.cy, position: Position.Top }
  }
  const halfW = from.width / 2
  const halfH = from.height / 2
  // Largest t such that (t*dx, t*dy) stays inside the half-extents.
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : halfW / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : halfH / Math.abs(dy)
  )
  const x = from.cx + dx * scale
  const y = from.cy + dy * scale
  // The side we exited decides the bezier control-point direction.
  const exitedVertically = Math.abs(dy) * halfW >= Math.abs(dx) * halfH
  const position = exitedVertically
    ? dy > 0
      ? Position.Bottom
      : Position.Top
    : dx > 0
      ? Position.Right
      : Position.Left
  return { x, y, position }
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

const EMPHASIS_STROKE: Record<ProjectTeamEdgeEmphasis, { opacity: number; width: number }> = {
  // Never hidden, never removed from the DOM — only pushed back.
  faint: { opacity: 0.1, width: 1 },
  normal: { opacity: 0.32, width: 1 },
  prominent: { opacity: 0.75, width: 1.75 },
}

function ProjectTeamEdgeComponent({
  id,
  source,
  target,
  markerEnd,
  data,
}: EdgeProps<ProjectTeamFlowEdge>) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  // Hover lives HERE, not in the shared edge array — see `showLabel` above.
  // Hovering this edge re-renders this edge and nothing else.
  const [hovered, setHovered] = useState(false)

  const sourceBox = boxOf(sourceNode)
  const targetBox = boxOf(targetNode)
  // Before the first measure pass React Flow has no dimensions; drawing a
  // 0-length edge at the origin would flash a stray line, so draw nothing.
  if (!sourceBox || !targetBox || !data) return null

  const from = borderPoint(sourceBox, targetBox)
  const to = borderPoint(targetBox, sourceBox)

  const [path, labelX, labelY] = getBezierPath({
    sourceX: from.x,
    sourceY: from.y,
    sourcePosition: from.position,
    targetX: to.x,
    targetY: to.y,
    targetPosition: to.position,
    curvature: 0.2,
  })

  const stroke = EMPHASIS_STROKE[data.emphasis]
  const derived = data.origin === 'derived'
  const directed = isDirectedRelation(data.relation)

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        // Arrowhead only for a genuinely directed relation. Membership and
        // shares-tool are symmetric statements and get none.
        markerEnd={directed ? markerEnd : undefined}
        className={clsx(
          'ptc-edge',
          data.animateFlow && 'ptc-flow',
          // A derived edge is dashed: a computed guess must never look
          // configured. An animated flow reuses the same dash pattern, so the
          // two never contradict each other.
          derived && !data.animateFlow && 'ptc-derived'
        )}
        style={{
          stroke: data.active ? 'var(--accent-line-strong)' : 'var(--color-zinc-500)',
          strokeOpacity: stroke.opacity,
          // Real activity is ALSO carried by weight, so the fact survives with
          // motion disabled.
          strokeWidth: data.active && data.emphasis === 'prominent' ? stroke.width + 0.5 : stroke.width,
        }}
      />
      {data.emphasis === 'faint' ? null : (
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={HOVER_HIT_WIDTH}
          style={{ pointerEvents: 'stroke' }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        />
      )}
      {data.emphasis === 'faint' ? null : (
        <EdgeLabelRenderer>
          <div
            // `nodrag nopan` keeps the label from stealing canvas gestures.
            className={clsx(
              'ptc-edge-label nodrag nopan pointer-events-none absolute rounded-md bg-[var(--color-surface-elevated)] px-1.5 py-0.5 text-[10px] whitespace-nowrap text-zinc-300 ring-1 ring-white/10 transition-opacity duration-200',
              data.showLabel || hovered ? 'opacity-100' : 'opacity-0'
            )}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data.label ?? RELATION_LABEL[data.relation]}
            {derived ? <span className="ml-1 text-zinc-500">(derived)</span> : null}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const ProjectTeamEdgeLine = memo(ProjectTeamEdgeComponent)
ProjectTeamEdgeLine.displayName = 'ProjectTeamEdgeLine'
