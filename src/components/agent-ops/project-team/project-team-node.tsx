'use client'

import {
  ArrowPathIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  NoSymbolIcon,
  PauseCircleIcon,
  PencilSquareIcon,
  QuestionMarkCircleIcon,
  RectangleGroupIcon,
  Squares2X2Icon,
} from '@heroicons/react/20/solid'
import * as Headless from '@headlessui/react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import clsx from 'clsx'
import { memo } from 'react'

import { TEAM_NODE_SIZE } from '@/lib/agent-mission-control/project-team/layout'
import type {
  ProjectTeamNode,
  ProjectTeamNodeStatus,
} from '@/lib/agent-mission-control/project-team/types'

/**
 * Project team canvas — node renderers (project anchor / group / agent).
 *
 * PRESENTATIONAL ONLY. No fetching, no routing, no filtering: the node draws
 * exactly the `ProjectTeamNode` it is handed and reports clicks upward.
 *
 * STATUS IS NEVER COLOR-ONLY. The palette is accent(green) + zinc, so the seven
 * statuses are told apart by FOUR redundant channels — a dedicated icon, a
 * border STYLE (solid / dashed / dotted / double), an opacity step, and an
 * always-visible text label. Remove all colour and the state still reads. The
 * accent hue is a reinforcement on `active` only, never the sole carrier.
 */

// ---------------------------------------------------------------------------
// Status presentation — icon + border style + label + opacity, never hue alone
// ---------------------------------------------------------------------------

interface StatusPresentation {
  label: string
  icon: typeof ClockIcon
  /** Border STYLE + weight is the primary non-colour differentiator. */
  border: string
  /** Opacity step — a secondary, colour-free signal of "how live is this". */
  opacity: string
  /** Icon tint stays inside accent/zinc; it only reinforces the icon shape. */
  tone: string
  /** True for the one state that earns a live pulse (motion-safe). */
  live: boolean
}

const STATUS_PRESENTATION: Record<ProjectTeamNodeStatus, StatusPresentation> = {
  // Running right now — the only accent-bordered state, plus a spinner glyph.
  active: {
    label: 'Active',
    icon: ArrowPathIcon,
    border: 'border-solid border-2 border-[var(--accent-node-active)]',
    opacity: 'opacity-100',
    tone: 'text-accent-400',
    live: true,
  },
  // Human-in-the-loop gate — dashed reads as "interrupted / not continuous".
  waiting: {
    label: 'Waiting',
    icon: ClockIcon,
    border: 'border-dashed border-2 border-zinc-400/70',
    opacity: 'opacity-100',
    tone: 'text-zinc-200',
    live: false,
  },
  // Terminal refusal — double border reads as a wall.
  blocked: {
    label: 'Blocked',
    icon: NoSymbolIcon,
    border: 'border-double border-4 border-zinc-200/80',
    opacity: 'opacity-100',
    tone: 'text-zinc-100',
    live: false,
  },
  // Terminal error — heaviest solid border, warning glyph.
  failed: {
    label: 'Failed',
    icon: ExclamationTriangleIcon,
    border: 'border-solid border-2 border-zinc-100/80',
    opacity: 'opacity-100',
    tone: 'text-zinc-100',
    live: false,
  },
  // Available, nothing happening — the quiet baseline.
  idle: {
    label: 'Idle',
    icon: PauseCircleIcon,
    border: 'border-solid border border-zinc-700',
    opacity: 'opacity-90',
    tone: 'text-zinc-500',
    live: false,
  },
  // Not materialized yet — dotted reads as "not built".
  draft: {
    label: 'Draft',
    icon: PencilSquareIcon,
    border: 'border-dotted border-2 border-zinc-600',
    opacity: 'opacity-90',
    tone: 'text-zinc-500',
    live: false,
  },
  // Data could not be read. Deliberately the faintest state, and its metrics
  // are suppressed rather than rendered as a fabricated zero.
  unavailable: {
    label: 'Unavailable',
    icon: QuestionMarkCircleIcon,
    border: 'border-dotted border border-zinc-800',
    opacity: 'opacity-60',
    tone: 'text-zinc-600',
    live: false,
  },
}

/** How prominent this node is under the current selection/view mode. */
export type ProjectTeamNodeEmphasis = 'primary' | 'neighbour' | 'muted'

const EMPHASIS_CLASS: Record<ProjectTeamNodeEmphasis, string> = {
  primary: 'opacity-100',
  neighbour: 'opacity-100',
  // Never removed from the DOM — only pushed back visually.
  muted: 'opacity-25',
}

export type ProjectTeamNodeData = {
  node: ProjectTeamNode
  emphasis: ProjectTeamNodeEmphasis
  isSelected: boolean
  /** Agents inside this group. `null` for non-group nodes. */
  memberCount: number | null
  onSelect: ((nodeId: string) => void) | null
}

export type ProjectTeamFlowNode = Node<ProjectTeamNodeData, 'team-node'>

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/** Initials from a display name — 2 letters max, never more. */
function monogram(name: string): string {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/**
 * Hidden connection points. The custom edge computes a FLOATING geometry from
 * node centres (the layout is radial, so edges arrive from any angle) — these
 * handles exist only so React Flow can anchor an edge without warning.
 */
function EdgeAnchors() {
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} className="ptc-anchor" />
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="ptc-anchor" />
    </>
  )
}

/**
 * MOTION BUDGET — the live animations are BOUNDED, not infinite.
 *
 * `ptc-spin` (1.8s) and `ptc-pulse` (2.4s) are declared `infinite` in the
 * canvas stylesheet. Correctly earned by data, correctly killed by
 * `prefers-reduced-motion` — but uncapped: a project with many simultaneously
 * active agents ran two unbounded compositor animations PER NODE, forever.
 *
 * Capping the iteration count inline bounds them to ~18-19s of motion. Nothing
 * is lost when they stop: "active" is also carried by the ArrowPath glyph, the
 * accent border, the accent dot and the literal "ACTIVE" text label — the
 * motion was always reinforcement, never the sole carrier (same contract the
 * reduced-motion path already honours).
 *
 * The inline value overrides only `animation-iteration-count`. Under
 * `prefers-reduced-motion` the stylesheet's `animation: none` still wins on
 * `animation-name`, so no animation runs at all — the cap cannot resurrect it.
 *
 * Re-armed by `liveKey`: a new run remounts the animated element, so an agent
 * that keeps working keeps pulsing. It settles only once the data does.
 */
const SPIN_ITERATIONS = 10 // 1.8s × 10 ≈ 18s
const PULSE_ITERATIONS = 8 // 2.4s × 8 ≈ 19s

/** Identity of the current run — changes when the agent starts a new one. */
function liveKeyOf(node: ProjectTeamNode): string {
  return `${node.latestRun?.id ?? ''}:${node.latestRun?.startedAt ?? ''}`
}

function StatusMark({ status, liveKey }: { status: ProjectTeamNodeStatus; liveKey: string }) {
  const presentation = STATUS_PRESENTATION[status]
  const Icon = presentation.icon
  return (
    <span className="inline-flex items-center gap-1">
      <Icon
        key={presentation.live ? liveKey : 'static'}
        aria-hidden="true"
        className={clsx('size-3.5 shrink-0', presentation.tone, presentation.live && 'ptc-spin')}
        style={presentation.live ? { animationIterationCount: SPIN_ITERATIONS } : undefined}
      />
      <span className={clsx('text-[10px] font-medium tracking-wider uppercase', presentation.tone)}>
        {presentation.label}
      </span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Node body
// ---------------------------------------------------------------------------

const shellBase =
  'group relative flex h-full w-full flex-col justify-between rounded-xl bg-[var(--color-surface-interactive)] text-left transition-[opacity,box-shadow,border-color] duration-200 ease-out focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400'

/**
 * Selection ring. Deliberately an OFFSET outline: no status uses one, so
 * "selected" is unmistakable without introducing a colour outside the palette.
 */
const selectedClass = 'ring-2 ring-[var(--accent-node-selected)] ring-offset-2 ring-offset-[var(--color-surface-canvas)]'

function ProjectBody({ node, memberCount }: { node: ProjectTeamNode; memberCount: number | null }) {
  return (
    <div className="flex h-full flex-col justify-center gap-1 px-4 py-3">
      <span className="text-[10px] font-medium tracking-widest text-zinc-500 uppercase">Project</span>
      <span className="truncate text-base font-semibold text-white">{node.name}</span>
      <span className="truncate text-xs text-zinc-400">
        {memberCount === null ? 'Team' : `${memberCount} ${memberCount === 1 ? 'agent' : 'agents'}`}
      </span>
    </div>
  )
}

function GroupBody({ node, memberCount }: { node: ProjectTeamNode; memberCount: number | null }) {
  return (
    <div className="flex h-full items-center gap-3 px-4 py-3">
      <RectangleGroupIcon aria-hidden="true" className="size-5 shrink-0 text-zinc-500" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-white">{node.name}</div>
        <div className="truncate text-xs text-zinc-500">
          {memberCount === null ? 'Team' : `${memberCount} ${memberCount === 1 ? 'agent' : 'agents'}`}
        </div>
      </div>
    </div>
  )
}

function AgentBody({ node }: { node: ProjectTeamNode }) {
  const presentation = STATUS_PRESENTATION[node.status]
  // A `null` count means UNKNOWN (unreadable, or not exactly countable) and is
  // driven by the metric itself, not inferred from the node status — the two
  // can disagree. A measured `0` still renders as "0 runs": "never ran" and
  // "we could not read the runs" must never look the same.
  // The SAME rule applies to the daily count on its own: an unread `runsToday`
  // must not render like a measured 0, so it is stated, not silently omitted.
  //   5 total, 2 today → "2 today · 5 total"
  //   5 total, 0 today → "5 runs"                    (nothing ran today)
  //   5 total, ? today → "5 runs · today unavailable"
  const { runsToday, totalRuns } = node.metrics
  const runsLabel =
    totalRuns === null
      ? 'runs unavailable'
      : runsToday === null
        ? `${totalRuns} ${totalRuns === 1 ? 'run' : 'runs'} · today unavailable`
        : runsToday > 0
          ? `${runsToday} today · ${totalRuns} total`
          : `${totalRuns} ${totalRuns === 1 ? 'run' : 'runs'}`

  // Secondary identity line: runtime and model are metadata, kept to ONE line.
  const secondary = [node.runtime, node.model].filter(Boolean).join(' · ')

  return (
    <div className="flex h-full flex-col gap-2 px-3 py-3">
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[11px] font-semibold text-accent-300 ring-1 ring-[var(--accent-line)]"
        >
          {monogram(node.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-white">{node.name}</div>
          <div className="truncate text-xs text-zinc-500">{node.role ?? (secondary || '—')}</div>
        </div>
        {/* Activity indicator: shape + motion, and the text label below carries
            the same fact statically for reduced-motion / colour-blind readers. */}
        <span
          key={presentation.live ? liveKeyOf(node) : 'static'}
          aria-hidden="true"
          className={clsx(
            'mt-1 size-2 shrink-0 rounded-full',
            presentation.live ? 'bg-accent-400 ptc-pulse' : 'bg-zinc-700'
          )}
          style={presentation.live ? { animationIterationCount: PULSE_ITERATIONS } : undefined}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <StatusMark status={node.status} liveKey={liveKeyOf(node)} />
        <span className="truncate text-[10px] text-zinc-500">{runsLabel}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Exported node component
// ---------------------------------------------------------------------------

function ProjectTeamNodeComponent({ data }: NodeProps<ProjectTeamFlowNode>) {
  const { node, emphasis, isSelected, memberCount, onSelect } = data
  const presentation = STATUS_PRESENTATION[node.status]
  const size = TEAM_NODE_SIZE[node.kind]

  // The anchor must never be mistaken for an agent: heavier border, wider box,
  // and no status chrome (a project has no run status of its own).
  const kindBorder =
    node.kind === 'project'
      ? 'border-solid border-2 border-zinc-500'
      : node.kind === 'group'
        ? 'border-dashed border border-zinc-700'
        : presentation.border

  const accessibleLabel =
    node.kind === 'agent'
      ? `${node.name}, agent, status ${presentation.label}`
      : node.kind === 'group'
        ? `${node.name}, team group${memberCount === null ? '' : `, ${memberCount} agents`}`
        : `${node.name}, project`

  return (
    <div
      className={clsx('ptc-node', EMPHASIS_CLASS[emphasis])}
      style={{ width: size.width, height: size.height }}
    >
      <EdgeAnchors />
      {/*
        * Headless.Button, never a native element: this path is gated
        * (check-catalyst), and a Catalyst `Button` would drag its own padding
        * and surface in. Headless gives the real button semantics — keyboard
        * focus, Enter/Space activation, disabled handling — with zero visual
        * opinion, which is exactly what a canvas node needs.
      */}
      <Headless.Button
        aria-label={accessibleLabel}
        aria-pressed={isSelected}
        disabled={onSelect === null}
        onClick={() => onSelect?.(node.id)}
        className={clsx(
          shellBase,
          kindBorder,
          node.kind === 'agent' && presentation.opacity,
          isSelected && selectedClass,
          onSelect !== null && 'cursor-pointer hover:border-zinc-500'
        )}
      >
        {node.kind === 'project' ? (
          <ProjectBody node={node} memberCount={memberCount} />
        ) : node.kind === 'group' ? (
          <GroupBody node={node} memberCount={memberCount} />
        ) : (
          <AgentBody node={node} />
        )}
        {node.kind === 'project' ? (
          <Squares2X2Icon aria-hidden="true" className="absolute top-3 right-3 size-4 text-zinc-600" />
        ) : null}
      </Headless.Button>
    </div>
  )
}

/**
 * Memoized: React Flow re-renders every node whenever the node array changes.
 * The canvas rebuilds node `data` only on a real change (selection, view mode,
 * status refresh), so reference equality here keeps untouched nodes idle.
 */
export const ProjectTeamNodeCard = memo(ProjectTeamNodeComponent)
ProjectTeamNodeCard.displayName = 'ProjectTeamNodeCard'

export { STATUS_PRESENTATION }
