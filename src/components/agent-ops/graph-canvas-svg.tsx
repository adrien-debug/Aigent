'use client'

// --- Pure presentational LangGraph canvas ----------------------------------
// This module owns ONLY the low-level SVG rendering of the agent_builder graph.
// It has ZERO data-fetching, ZERO polling, ZERO state — it draws exactly the
// state passed in via props. Callers (the read-only explorer at /admin/langgraph
// today, a live test panel tomorrow) derive `nodeStatus` / `traversedEdges`
// however they like and hand them here. All the drawing constants, layout, and
// topology fallbacks are exported so other consumers reuse the SAME diagram.

// --- agent_builder topology: KNOWN layout + hard-coded FALLBACK --------------
// Consumers key their status/replay logic on the KNOWN node ids (a stable
// union). The canvas RENDERS from whatever topology is passed in, else this
// fallback.
export type NodeId = '__start__' | 'agent' | 'approval' | 'tools' | '__end__'
export const NODE_IDS: NodeId[] = ['__start__', 'agent', 'approval', 'tools', '__end__']

/** A node ready to draw: string id (may be an unknown/new topology node) + layout. */
export interface RenderNode {
  id: string
  label: string
  role: string
  type?: string
  x: number
  y: number
}
/** A drawable edge. */
export interface RenderEdge {
  source: string
  target: string
  conditional: boolean
}

export interface TopologyNode {
  id: string
  label: string
  type?: string
}
export interface TopologyEdge {
  source: string
  target: string
  conditional?: boolean
}

// Fixed positions + roles for the KNOWN agent_builder nodes. A topology node not
// in here is laid out automatically (see buildLayout). Tuned for a compact,
// centred diamond that fills the viewBox without dead space.
export const KNOWN_POSITIONS: Record<NodeId, { x: number; y: number }> = {
  __start__: { x: 300, y: 34 },
  agent: { x: 300, y: 120 },
  approval: { x: 148, y: 210 },
  tools: { x: 300, y: 300 },
  __end__: { x: 452, y: 210 },
}
const NODE_ROLES: Record<NodeId, string> = {
  __start__: 'Entry point — the run begins here.',
  agent: 'ChatOpenAI bound to the copilot tools. Decides the next tool call or the final answer.',
  approval: 'Human-in-the-loop gate. interrupt()s before a confirmation-required tool.',
  tools: 'Executes the approved tool call, then loops back to agent.',
  __end__: 'Terminal node — the run finished (final answer produced).',
}

// Hard-coded FALLBACK topology (used when no topology is passed in).
export const FALLBACK_NODES: { id: NodeId; type: string }[] = [
  { id: '__start__', type: 'schema' },
  { id: 'agent', type: 'runnable' },
  { id: 'approval', type: 'runnable' },
  { id: 'tools', type: 'runnable' },
  { id: '__end__', type: 'schema' },
]
export const FALLBACK_EDGES: RenderEdge[] = [
  { source: '__start__', target: 'agent', conditional: false },
  { source: 'agent', target: 'approval', conditional: true },
  { source: 'agent', target: '__end__', conditional: true },
  { source: 'approval', target: 'tools', conditional: true },
  { source: 'approval', target: 'agent', conditional: true },
  { source: 'tools', target: 'agent', conditional: false },
]

/** Build the render nodes with layout: known ids get fixed positions; any extra
 * topology node is auto-placed in a spare column so it's visible but never
 * fabricated onto a known spot. */
export function buildLayout(nodes: TopologyNode[]): RenderNode[] {
  let extra = 0
  return nodes.map((n) => {
    const known = KNOWN_POSITIONS[n.id as NodeId]
    const pos = known ?? { x: 520, y: 40 + extra++ * 80 }
    return {
      id: n.id,
      label: n.label || n.id,
      role: NODE_ROLES[n.id as NodeId] ?? `Graph node "${n.id}" (${n.type ?? 'node'}).`,
      type: n.type,
      x: pos.x,
      y: pos.y,
    }
  })
}

export type StepStatus = 'completed' | 'active' | 'interrupted' | 'error' | 'idle' | 'unknown'

const NODE_W = 96
const NODE_H = 34
const VB_W = 600
const VB_H = 344

// --- SVG pieces ------------------------------------------------------------

/**
 * Shared SVG defs + scoped animations. Gradients per state, a soft drop shadow,
 * an accent glow for the live node, and keyframes: a gentle pulse on the
 * active/interrupted node, a flowing dash on traversed edges, and a spring
 * fade-in on mount. All motion is disabled under prefers-reduced-motion.
 */
function CanvasDefs() {
  return (
    <>
      <defs>
        {/* Node surface gradients — subtle top-lit sheen, never flat. */}
        <linearGradient id="node-idle" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="color-mix(in oklab, var(--color-zinc-500) 8%, transparent)" />
          <stop offset="100%" stopColor="color-mix(in oklab, var(--color-zinc-500) 2%, transparent)" />
        </linearGradient>
        <linearGradient id="node-completed" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="color-mix(in oklab, var(--color-zinc-500) 14%, transparent)" />
          <stop offset="100%" stopColor="color-mix(in oklab, var(--color-zinc-500) 5%, transparent)" />
        </linearGradient>
        <linearGradient id="node-hot" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent-soft)" />
          <stop offset="100%" stopColor="var(--accent-surface)" />
        </linearGradient>
        {/* Soft drop shadow for elevation. */}
        <filter id="node-shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="2" floodColor="var(--color-zinc-900)" floodOpacity="0.12" />
        </filter>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-zinc-400)" />
        </marker>
        <marker id="arrow-hot" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent-line)" />
        </marker>
      </defs>
      <style>{`
        /* Fade-in ONLY on opacity — the group's transform carries the node's
           position, so animating transform here would stack every node at the
           origin. */
        .lg-node { opacity: 0; animation: lg-in 340ms ease-out forwards; }
        .lg-node rect { transition: stroke-width 180ms ease, filter 200ms ease; }
        .lg-node:hover rect.lg-surface { filter: url(#node-shadow) brightness(1.03); }
        /* Visible keyboard focus ring — SVG has no reliable outline, so the
           focus indicator is a dedicated rect drawn only on :focus-visible
           (never on mouse click), matching the accent ring used elsewhere. */
        .lg-node rect.lg-focus-ring { opacity: 0; pointer-events: none; }
        .lg-node:focus-visible rect.lg-focus-ring { opacity: 1; }
        .lg-flow { stroke-dasharray: 5 7; animation: lg-dash 1.1s linear infinite; }
        @keyframes lg-in { to { opacity: 1; } }
        @keyframes lg-dash { to { stroke-dashoffset: -24; } }
        @media (prefers-reduced-motion: reduce) {
          .lg-node { opacity: 1; animation: none; }
          .lg-flow { animation: none; }
        }
      `}</style>
    </>
  )
}

function NodeBox({ node, status, selected, onSelect, index }: { node: RenderNode; status: StepStatus; selected: boolean; onSelect?: () => void; index: number }) {
  const hot = status === 'interrupted' || status === 'active'
  const fillId =
    hot ? 'url(#node-hot)' : status === 'completed' ? 'url(#node-completed)' : 'url(#node-idle)'
  const stroke =
    status === 'interrupted' || status === 'active'
      ? 'var(--accent-line)'
      : status === 'error'
        ? 'var(--color-accent-800)'
        : status === 'completed'
          ? 'var(--color-zinc-500)'
          : 'var(--color-zinc-300)'
  const interactive = Boolean(onSelect)
  return (
    <g
      className={`lg-node outline-hidden ${interactive ? 'cursor-pointer' : ''}`}
      style={{ animationDelay: `${index * 55}ms` }}
      transform={`translate(${node.x - NODE_W / 2}, ${node.y - NODE_H / 2})`}
      onClick={interactive ? onSelect : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect?.()
              }
            }
          : undefined
      }
      aria-label={`${node.label} — ${status}`}
      aria-pressed={interactive ? selected : undefined}
    >
      {/* Invisible hit-target: the drawn card is only NODE_H (34px) tall, below
          the 44px touch-target minimum. This transparent rect extends the
          clickable/tappable area to 44px without altering the visual diagram
          layout (KNOWN_POSITIONS / viewBox are tuned and shouldn't move). */}
      {interactive ? (
        <rect
          x={0}
          y={NODE_H / 2 - 22}
          width={NODE_W}
          height={44}
          fill="transparent"
          pointerEvents="all"
        />
      ) : null}
      {/* Base card (white so the gradient reads on any bg) + gradient surface. */}
      <rect width={NODE_W} height={NODE_H} rx={9} className="fill-white dark:fill-zinc-900" filter="url(#node-shadow)" />
      <rect className="lg-surface" width={NODE_W} height={NODE_H} rx={9} fill={fillId} stroke={stroke} strokeWidth={selected ? 2 : 1.25} />
      {/* Keyboard focus ring — shown only on :focus-visible via CanvasDefs CSS. */}
      <rect
        className="lg-focus-ring"
        x={-3}
        y={-3}
        width={NODE_W + 6}
        height={NODE_H + 6}
        rx={11}
        fill="none"
        stroke="var(--accent-line-strong, var(--accent-line))"
        strokeWidth={2.5}
      />
      <text x={NODE_W / 2} y={NODE_H / 2 - 2} textAnchor="middle" dominantBaseline="middle" className="fill-zinc-950 font-mono text-[10px] font-medium dark:fill-white">
        {node.label}
      </text>
      <text x={NODE_W / 2} y={NODE_H / 2 + 9} textAnchor="middle" dominantBaseline="middle" className="fill-zinc-500 text-[6.5px] font-semibold tracking-wider uppercase dark:fill-zinc-400">
        {status}
      </text>
    </g>
  )
}

function Edge({ a, b, dashed, traversed, index }: { a: RenderNode; b: RenderNode; dashed: boolean; traversed: boolean; index: number }) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const x1 = a.x + ux * (NODE_H / 2 + 3)
  const y1 = a.y + uy * (NODE_H / 2 + 3)
  const x2 = b.x - ux * (NODE_H / 2 + 8)
  const y2 = b.y - uy * (NODE_H / 2 + 8)
  // Gentle curve: bow the line perpendicular to its direction so parallel edges
  // (agent↔approval, agent↔tools) don't overlap and it reads softer.
  const mx = (x1 + x2) / 2 + -uy * 14
  const my = (y1 + y2) / 2 + ux * 14
  const d = `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`
  const stroke = traversed ? 'var(--accent-line)' : 'var(--color-zinc-300)'
  return (
    <g className="lg-node" style={{ animationDelay: `${index * 40}ms` }}>
      {/* Base edge. */}
      <path d={d} fill="none" stroke={stroke} strokeWidth={traversed ? 2 : 1.25} strokeDasharray={dashed && !traversed ? '4 4' : undefined} markerEnd={traversed ? 'url(#arrow-hot)' : 'url(#arrow)'} strokeLinecap="round" />
      {/* Animated flow overlay on traversed edges. */}
      {traversed ? <path className="lg-flow" d={d} fill="none" stroke="var(--accent-line)" strokeWidth={2} strokeLinecap="round" opacity={0.7} /> : null}
    </g>
  )
}

export function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={`size-2 rounded-full ${className}`} />
      {label}
    </span>
  )
}

/**
 * PURE presentational canvas. Renders the agent_builder graph from the props:
 * `nodeStatus` colours each node, `traversedEdges` highlights the path parcouru.
 * No fetch, no polling, no derived data state — the caller owns all of that.
 *
 * `nodes` / `edges` default to the hard-coded fallback topology; pass a live
 * topology to draw it instead. Edge highlight keys are `${source}→${target}`.
 */
export function GraphCanvasSvg({
  nodeStatus,
  traversedEdges,
  onNodeClick,
  selectedNodeId = null,
  nodes = FALLBACK_NODES.map((n) => ({ id: n.id, label: n.id, type: n.type })),
  edges = FALLBACK_EDGES,
  ariaLabel = 'graph',
}: {
  nodeStatus: Record<string, StepStatus>
  traversedEdges: Set<string>
  onNodeClick?: (id: string) => void
  selectedNodeId?: string | null
  nodes?: TopologyNode[]
  edges?: RenderEdge[]
  ariaLabel?: string
}) {
  const renderNodes = buildLayout(nodes)
  const renderNodeById = new Map(renderNodes.map((n) => [n.id, n]))
  const statusOf = (id: string): StepStatus => nodeStatus[id] ?? 'idle'
  return (
    <div>
      <div className="overflow-x-auto rounded-xl bg-gradient-to-b from-zinc-50 to-zinc-100/60 p-2 dark:from-zinc-900 dark:to-zinc-950/60">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-auto w-full min-w-[520px]" role="img" aria-label={ariaLabel}>
          <CanvasDefs />
          {edges.map((e, i) => {
            const a = renderNodeById.get(e.source)
            const b = renderNodeById.get(e.target)
            if (!a || !b) return null
            return <Edge key={i} a={a} b={b} dashed={e.conditional} traversed={traversedEdges.has(`${e.source}→${e.target}`)} index={i} />
          })}
          {renderNodes.map((n, i) => (
            <NodeBox key={n.id} node={n} status={statusOf(n.id)} selected={selectedNodeId === n.id} onSelect={onNodeClick ? () => onNodeClick(n.id) : undefined} index={i} />
          ))}
        </svg>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        <LegendDot className="bg-zinc-700 dark:bg-zinc-300" label="completed" />
        <LegendDot className="bg-accent-500" label="active" />
        <LegendDot className="bg-accent-600" label="interrupted" />
        <LegendDot className="bg-accent-700" label="error" />
        <LegendDot className="bg-zinc-400 dark:bg-zinc-500" label="idle / unknown" />
      </div>
    </div>
  )
}
