'use client'

import {
  ArrowDownLeftIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpRightIcon,
  XMarkIcon,
} from '@heroicons/react/20/solid'
import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { sectionLabelClass } from '@/components/agent-ops/authoring-primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Divider } from '@/components/ui/divider'
import { Subheading } from '@/components/ui/heading'
import { Link } from '@/components/ui/link'
import { RELATION_SENTENCE_LABEL } from './project-team-edge'
import type {
  ProjectTeamEdge,
  ProjectTeamGraph,
  ProjectTeamNode,
  ProjectTeamNodeStatus,
  ProjectTeamRunHistoryState,
} from '@/lib/agent-mission-control/project-team/types'

/* ==========================================================================
 * View layer over the read contract (project-team/types.ts).
 *
 * The contract already forbids fabrication (an unreadable value is `null`, a
 * node whose data could not be read is `unavailable`). This layer's only job is
 * to turn those nulls into an EXPLICIT unavailable affordance — never into a
 * zero, a dash that reads like "none", or an invented default.
 * ======================================================================== */

const percentFormat = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 })
const plainFormat = new Intl.NumberFormat('en-US')

/**
 * `sectionLabelClass` in `Subheading` form. The panel's section titles were raw
 * `<h3>` tags, which the dashboard is not entitled to — it renders primitives
 * only — but `Subheading` hard-codes `text-base/7 sm:text-sm/6 font-semibold`
 * and `text-zinc-950 dark:text-white`, and Tailwind settles a same-utility
 * clash by the order of the GENERATED CSS (`.text-base` after `.text-xs`,
 * `.font-semibold` after `.font-medium`, `.text-zinc-950` after
 * `.text-zinc-500`), never by the order of the class attribute. So every
 * property the primitive also sets is re-asserted with `!`; drop the `!` and
 * the primitive silently wins, turning every caption into semibold body text.
 *
 * `sectionLabelClass` itself stays the source of truth for the non-heading uses
 * (`<dt>` in `Field`) — this constant only exists because those two cannot share
 * one string once one of them has to fight the primitive.
 */
const panelSectionTitleClass = 'text-xs! font-medium! tracking-wide text-zinc-500! uppercase'

export interface TeamMetric {
  key: string
  label: string
  /** null = the backend could not measure it. Renders as "unavailable", never 0. */
  value: string | null
}

export interface TeamAgentView {
  id: string
  kind: ProjectTeamNode['kind']
  name: string
  slug: string | null
  role: string | null
  description: string | null
  team: string | null
  runtime: string | null
  model: string | null
  status: ProjectTeamNodeStatus
  href: string | null
  lastActivityAt: string | null
  latestRunId: string | null
  latestRunStatus: string | null
  metrics: TeamMetric[]
  tools: string[]
  /**
   * The tool read failed. `tools` is then an empty array that asserts NOTHING —
   * the renderer must say "could not be read", never "none declared".
   */
  toolsUnavailable: boolean
  /**
   * Why `lastActivityAt` is null. Without it, "never ran", "unreadable" and
   * "outside the read window" all render as the same sentence.
   */
  runHistory: ProjectTeamRunHistoryState
  /**
   * Same-day run count for this agent. `null` = the count could not be read —
   * NOT zero. A measured 0 and an unreadable count are different facts.
   */
  runsToday: number | null
}

/**
 * What to say about last activity when there is NO timestamp to show.
 *
 * The absent timestamp is the same `null` in all four cases; the fact behind it
 * is not. Only `known` licenses the positive claim that nothing ever ran.
 */
export function lastActivityFallback(runHistory: ProjectTeamRunHistoryState): string {
  switch (runHistory) {
    case 'unreadable':
      return 'unavailable — the runs could not be read'
    case 'outside-window':
      return 'unavailable — outside the read window'
    case 'not-applicable':
      return 'no run of its own'
    case 'known':
      // The ONLY case where the data actually says "this agent has never run".
      return 'no run recorded'
  }
}

/** Flatten one contract node into what every surface in this folder renders. */
export function toTeamAgentView(node: ProjectTeamNode): TeamAgentView {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    slug: node.slug,
    role: node.role,
    description: node.description,
    team: node.team,
    runtime: node.runtime,
    model: node.model,
    status: node.status,
    href: node.href,
    lastActivityAt: node.latestRun?.completedAt ?? node.latestRun?.startedAt ?? null,
    latestRunId: node.latestRun?.id ?? null,
    latestRunStatus: node.latestRun?.status ?? null,
    // Every metric is `null`-when-unknown all the way from the contract. The
    // renderer shows "n/a" for null — so an unread count reads as unknown, and
    // a real measured 0 still reads as 0.
    metrics: [
      {
        key: 'totalRuns',
        label: 'Total runs',
        value: node.metrics.totalRuns === null ? null : plainFormat.format(node.metrics.totalRuns),
      },
      {
        key: 'runsToday',
        label: 'Runs today',
        value: node.metrics.runsToday === null ? null : plainFormat.format(node.metrics.runsToday),
      },
      {
        key: 'successRate',
        label: 'Success rate',
        // null = no terminal run exists yet. A "0%" here would be a lie.
        value: node.metrics.successRate === null ? null : percentFormat.format(node.metrics.successRate),
      },
    ],
    tools: node.tools.map((tool) => tool.name),
    toolsUnavailable: node.toolsUnavailable,
    runHistory: node.runHistory,
    runsToday: node.metrics.runsToday,
  }
}

export interface TeamEdgeView {
  id: string
  source: string
  target: string
  relation: ProjectTeamEdge['relation']
  origin: ProjectTeamEdge['origin']
  label: string | null
  active: boolean
  lastActivityAt: string | null
  /**
   * Non-null ONLY for an edge backed by a real `project_agent_relations` row
   * — i.e. exactly the edges a `DELETE .../relations/{relationId}` call can
   * remove. Every derived edge (project/team membership, shares-tool) is
   * `null`. This is the ONLY signal the UI uses to decide whether to offer a
   * delete control — never `origin` alone, since `origin: 'explicit'` also
   * covers project-membership rows that have no relation id to delete.
   */
  relationId: string | null
}

export function toTeamEdgeView(edge: ProjectTeamEdge): TeamEdgeView {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    relation: edge.relation,
    origin: edge.origin,
    label: edge.label,
    active: edge.active,
    lastActivityAt: edge.lastActivityAt,
    relationId: edge.relationId,
  }
}

export function readGraphNodes(graph: ProjectTeamGraph | null): ProjectTeamNode[] {
  return graph?.nodes ?? []
}

export function readGraphEdges(graph: ProjectTeamGraph | null): ProjectTeamEdge[] {
  return graph?.edges ?? []
}

/** When the graph was built. Null only when there is no graph at all. */
export function readGraphFreshness(graph: ProjectTeamGraph | null): string | null {
  return graph?.generatedAt ?? null
}

const STATUS_LABELS: Record<ProjectTeamNodeStatus, string> = {
  active: 'Running',
  waiting: 'Waiting',
  blocked: 'Blocked',
  failed: 'Failed',
  idle: 'Idle',
  draft: 'Draft',
  unavailable: 'Unavailable',
}

export function humanizeStatus(status: string): string {
  if (status in STATUS_LABELS) return STATUS_LABELS[status as ProjectTeamNodeStatus]
  const spaced = status.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase().trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Age of a timestamp. Null when the timestamp is absent or unparseable — the
 * caller then renders the explicit unavailable affordance instead of a made-up
 * "just now".
 *
 * `now` is a PARAMETER, never `Date.now()` read inside the function. This body
 * runs during render, on the server first: reading the clock here made the
 * server emit "Refreshed 4s ago" and the client compute "3s ago" a moment
 * later, which is a hydration mismatch by construction — React logged
 * "Hydration failed because the server rendered text didn't match the client"
 * and threw the whole subtree away to re-render it. No jitter tolerance can fix
 * that: the two clocks are read at genuinely different instants.
 *
 * Same contract as `TimeAgoValue` (agent-detail/agent-value.tsx), which the
 * architecture test already pins for exactly this reason. Without `now` the
 * answer is the ABSOLUTE stamp — true at any instant, therefore identical on
 * both sides of hydration. `useRelativeNow()` below is what a client surface
 * passes to opt into the relative phrasing, and it only starts returning a
 * clock AFTER mount.
 */
export function formatAge(iso: string | null, now?: number): string | null {
  if (!iso) return null
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return null
  if (now === undefined) return `${new Date(then).toISOString().slice(0, 16).replace('T', ' ')} UTC`
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** How often the mounted clock advances. The graph itself polls on a 10s beat. */
const RELATIVE_NOW_TICK_MS = 10_000

/**
 * The wall clock as an EXTERNAL STORE — one interval for the whole page, shared
 * by every subscriber, so ten relation rows advance on the same tick instead of
 * running ten timers that drift apart.
 *
 * `null` until something subscribes. That is deliberate and load-bearing: it is
 * what `getServerSnapshot` and the first client snapshot both return, so the
 * two renders hydration has to match agree by construction rather than by luck.
 */
let sharedNow: number | null = null
const nowListeners = new Set<() => void>()
let nowTimer: ReturnType<typeof setInterval> | null = null

function subscribeToNow(onStoreChange: () => void): () => void {
  nowListeners.add(onStoreChange)
  if (nowTimer === null) {
    // Read once here rather than notifying: React re-reads the snapshot right
    // after `subscribe` returns and re-renders if it moved, which is exactly
    // the "clock arrives after mount" transition we want.
    sharedNow = Date.now()
    nowTimer = setInterval(() => {
      sharedNow = Date.now()
      for (const listener of nowListeners) listener()
    }, RELATIVE_NOW_TICK_MS)
  }
  return () => {
    nowListeners.delete(onStoreChange)
    if (nowListeners.size === 0 && nowTimer !== null) {
      clearInterval(nowTimer)
      nowTimer = null
      sharedNow = null
    }
  }
}

const readNow = (): number | null => sharedNow
/** The server has no clock to offer, and must not pretend to. */
const readNowOnServer = (): number | null => null

/**
 * The wall clock, but only once the component is MOUNTED.
 *
 * `undefined` on the server and on the first client render — the two renders
 * that have to agree byte for byte — so every `formatAge` call underneath
 * produces the absolute stamp in both. The store then supplies a real clock and
 * the labels become relative, as a normal post-mount update that hydration
 * never sees.
 *
 * The interval exists because the label would otherwise freeze at its mount
 * value: "Refreshed 0s ago" would still read "0s ago" a minute later, which is
 * a false claim about freshness, not merely a stale one.
 */
export function useRelativeNow(): number | undefined {
  const now = useSyncExternalStore(subscribeToNow, readNow, readNowOnServer)
  return now ?? undefined
}

/* ========================================================================== */

/**
 * Below `sm` the panel is `inset-0`: it covers the ENTIRE canvas opaquely, so
 * it is a modal in every way that matters to a user. This query is the single
 * definition of "full-bleed", and it drives both the focus trap and the
 * `aria-modal` value — the two can never disagree.
 * 639.98px because Tailwind's `sm` breakpoint is 40rem / 640px.
 */
const FULL_BLEED_QUERY = '(max-width: 639.98px)'

/** Tab-reachable descendants. `[tabindex="-1"]` (the heading) is programmatic only. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** True while the panel is the full-bleed variant. SSR-safe: starts false. */
function useFullBleed(): boolean {
  const [fullBleed, setFullBleed] = useState(false)
  useEffect(() => {
    const media = window.matchMedia(FULL_BLEED_QUERY)
    const sync = () => setFullBleed(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
  return fullBleed
}

/**
 * Contains Tab inside the panel while it covers the canvas. Without this, Tab
 * walked straight out of the panel into canvas nodes that are completely
 * hidden underneath it — focus on something invisible, again.
 *
 * Deliberately NOT active on `sm+`, where the panel is a 24rem side rail and
 * the canvas beside it is genuinely visible and genuinely reachable: trapping
 * there would be a regression, not a fix.
 *
 * ALSO deliberately suspended while a relation dialog is open (see `dialogOpen`
 * below). A Headless `Dialog` renders in a portal at BODY level, i.e. outside
 * `containerRef`, so `container.contains(document.activeElement)` is false for
 * every element of that dialog (measured in Chromium). This trap would then
 * read "focus escaped", `preventDefault()` the Tab, and try to pull focus back
 * to the panel's first control — which Headless has already marked `inert`, so
 * that `focus()` is a no-op (also measured: focus does not move at all). The
 * net effect is worse than losing focus: Tab is cancelled and focus is FROZEN
 * on whichever field it started on, so the operator can never reach the rest of
 * the form, nor its Cancel/Submit buttons, by keyboard. Headless runs its own
 * trap while it is open, so suspending this one leaves no gap.
 */
function useFocusTrap(containerRef: React.RefObject<HTMLDivElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab') return
      const container = containerRef.current
      if (!container) return
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) {
        // Nothing to move to — keep focus where it is rather than releasing it
        // onto the invisible canvas behind.
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active_ = document.activeElement as HTMLElement | null
      const inside = active_ !== null && container.contains(active_)
      if (event.shiftKey) {
        if (!inside || active_ === first) {
          event.preventDefault()
          last.focus()
        }
      } else if (!inside || active_ === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [containerRef, active])
}

const UNAVAILABLE = <span className="text-zinc-600">— unavailable</span>

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className={sectionLabelClass}>{label}</dt>
      <dd className="text-sm text-zinc-200">{children}</dd>
    </div>
  )
}

function RelationRow({
  edge,
  counterpart,
  direction,
  agentName,
  now,
  onDelete,
}: {
  edge: TeamEdgeView
  counterpart: TeamAgentView | undefined
  direction: 'in' | 'out'
  /** Name of the currently-open agent, to phrase the delete confirmation. */
  agentName: string
  /**
   * Mounted clock, threaded down from the panel rather than read per row: one
   * `useRelativeNow()` for the whole panel means one interval, and every row's
   * label advances on the same tick instead of drifting apart.
   */
  now: number | undefined
  /** Absent on a graph the caller has not wired for mutation. */
  onDelete?: (relationId: string, description: string) => void
}) {
  const Icon = direction === 'in' ? ArrowDownLeftIcon : ArrowUpRightIcon
  const age = formatAge(edge.lastActivityAt, now)
  const counterpartName = counterpart?.name ?? (direction === 'in' ? edge.source : edge.target)
  const relationLabel = edge.label ?? RELATION_SENTENCE_LABEL[edge.relation]
  // Narrowed to a local `const` (not a cast): only inside this block does
  // TypeScript know the relation id is non-null, which is also exactly the
  // condition under which the delete control may render at all.
  const relationId = edge.relationId
  const description =
    direction === 'out' ? `${relationLabel}: ${agentName} → ${counterpartName}` : `${relationLabel}: ${counterpartName} → ${agentName}`

  return (
    <li className="flex items-start gap-3 py-2">
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-zinc-500" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-zinc-200">{counterpartName}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          <span>{relationLabel}</span>
          {/* Provenance is load-bearing, not decoration: a relation the platform
              INFERRED must never read like something an operator configured. */}
          <Badge color="zinc">{edge.origin === 'derived' ? 'Derived' : 'Configured'}</Badge>
          {age ? <span>· {age}</span> : null}
        </p>
      </div>
      {/* Deletable if and only if a real `project_agent_relations` row backs
          this edge. A derived row (relationId === null) gets NO control —
          there is no row to delete. */}
      {relationId !== null && onDelete ? (
        <Headless.Button
          onClick={() => onDelete(relationId, description)}
          className="-my-2 flex size-11 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-500"
        >
          <XMarkIcon aria-hidden="true" className="size-3.5" />
          <span className="sr-only">Delete relation: {description}</span>
        </Headless.Button>
      ) : null}
    </li>
  )
}

export function ProjectTeamPanel({
  agent,
  incoming,
  outgoing,
  nodesById,
  onClose,
  onAddRelation,
  onDeleteRelation,
  dialogOpen,
  addRelationRef,
}: {
  agent: TeamAgentView
  incoming: TeamEdgeView[]
  outgoing: TeamEdgeView[]
  nodesById: Map<string, TeamAgentView>
  onClose: () => void
  /** Opens the create-relation dialog for the currently-open agent. */
  onAddRelation: () => void
  /** Opens the delete-relation confirm for one explicit relation. */
  onDeleteRelation: (relationId: string, description: string) => void
  /**
   * True while a relation dialog (create or delete) is open on top of this
   * panel. Those dialogs are Headless `Dialog`s rendered in a portal at BODY
   * level, so they are NOT descendants of this panel — every DOM-scoped
   * behaviour here has to stand down for them:
   *   - the focus trap, which would otherwise cancel Tab and try to pull focus
   *     into a tree Headless has marked `inert` (→ focus lands on `<body>`);
   *   - the Escape handler, which is registered on `document` while Headless
   *     registers on `window`; `document` comes FIRST in the bubble path, so
   *     the panel would close before the dialog ever saw the key.
   * An explicit flag from the owner of both, not a DOM sniff: the owner already
   * knows the answer, and a `closest('[data-headlessui-portal]')` probe breaks
   * the day that private attribute is renamed.
   */
  dialogOpen: boolean
  /**
   * Focus target after a relation is deleted. The row's `×` that had focus is
   * removed by the refresh that follows, so focus would otherwise drop to
   * `<body>`; the owner moves it here instead.
   */
  addRelationRef?: React.RefObject<HTMLElement | null>
}) {
  const headingRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const now = useRelativeNow()
  const fullBleed = useFullBleed()
  useFocusTrap(containerRef, fullBleed && !dialogOpen)

  // Focus moves INTO the panel on open and returns to whatever opened it on
  // close (a canvas node, a row of the accessible list) — keyboard users are
  // never dumped back at the top of the document.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    headingRef.current?.focus()
    return () => {
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus()
    }
  }, [agent.id])

  // Escape closes the panel — but ONLY when the panel is the topmost layer.
  //
  // The listener is not merely guarded, it is not registered at all while a
  // relation dialog is open. This one is on `document`, Headless's is on
  // `window`, and `window` comes AFTER `document` on the bubble path, so this
  // handler ran first — and its `stopPropagation()` then stopped the event
  // before it ever reached `window`. Measured in Chromium: with both listeners
  // attached, an Escape dispatched from an input fires `document` only and
  // `window` never runs at all. So the panel did not merely close alongside the
  // dialog; it closed INSTEAD of it, swallowing the key the dialog needed.
  // `stopPropagation` is the cause here, not a possible cure — and
  // `stopImmediatePropagation` would only make it worse. Not registering while
  // a dialog is open is the correct fix.
  //
  // Consequence beyond the stray close, before the mount-on-payload fix (see
  // `addRelationSource` in project-team-view.tsx): the dialog used to be
  // mounted under the selected agent, so closing the panel unmounted it
  // MID-SUBMIT — a failing request then set state on a dead component and the
  // operator was never told the relation had not been created. Both relation
  // dialogs are now mounted on their own captured payload, independent of
  // `selectedAgent`, so closing the panel can no longer take a dialog down
  // with a request in flight.
  useEffect(() => {
    if (dialogOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, dialogOpen])

  const agentLinks =
    agent.kind === 'agent'
      ? [
          { label: 'Open agent', href: `/admin/agents/${agent.id}` },
          { label: 'Open runs', href: `/admin/agents/${agent.id}/runs` },
          { label: 'Open benchmark', href: `/admin/agents/${agent.id}/tests#benchmarks` },
          { label: 'Open configuration', href: `/admin/agents/${agent.id}/manifest` },
        ]
      : []

  // Relations are agent-to-agent (`sourceCopilotId`/`targetCopilotId`) — a
  // project hub or a tag-derived group is never a valid source, so the
  // control is not offered at all rather than offered and rejected 422.
  const canAddRelation = agent.kind === 'agent'

  const age = formatAge(agent.lastActivityAt, now)
  const derivedOnly =
    incoming.concat(outgoing).length > 0 &&
    incoming.concat(outgoing).every((edge) => edge.origin === 'derived')

  return (
    <div
      ref={containerRef}
      role="dialog"
      // Truthful, and derived from the SAME query as the trap: full-bleed below
      // `sm` (covers the canvas, focus contained) → modal; side rail from `sm`
      // up (canvas visible and reachable beside it) → not modal.
      aria-modal={fullBleed}
      aria-label={`${agent.name} details`}
      className={clsx(
        // Overlay, never a layout column: the canvas keeps its full width
        // underneath instead of being squeezed every time a node is clicked.
        'absolute inset-0 z-20 flex flex-col overflow-y-auto border-white/10 bg-[var(--color-surface-canvas)]',
        'sm:inset-y-0 sm:right-0 sm:left-auto sm:w-96 sm:border-l lg:w-[26rem]'
      )}
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-white/5 bg-[var(--color-surface-canvas)] px-5 py-4">
        <div ref={headingRef} tabIndex={-1} className="min-w-0 focus:outline-none">
          <Subheading level={2} tone="neutral" className="truncate tracking-tight text-white">
            {agent.name}
          </Subheading>
          <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">{agent.slug ?? agent.id}</p>
        </div>
        <Headless.Button
          onClick={onClose}
          aria-label="Close agent details"
          className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          <XMarkIcon aria-hidden="true" className="size-5" />
        </Headless.Button>
      </div>

      <div className="flex flex-col gap-6 px-5 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-zinc-400">{humanizeStatus(agent.status)}</span>
          {agent.team ? <Badge color="zinc">{agent.team}</Badge> : null}
        </div>

        {/* A `<p>`, not `Text`. `Text` composes `clsx(className, 'text-base/6
            text-zinc-500 sm:text-sm/6 dark:text-zinc-400')`, so the caller's
            `text-sm text-zinc-400` was a silent no-op — Tailwind settles two
            utilities of one property by the order of the GENERATED CSS, never by
            the class attribute (`check-class-collision` flagged both). The
            description therefore rendered at 16px below 640px while every other
            paragraph of this panel ("No tool declared.", "No incoming
            relation…") is a plain `<p className="text-sm text-zinc-400">`, i.e.
            14px at every width. Dropping the primitive makes the override REAL
            instead of decorative and puts the panel's body type on one size. */}
        {agent.description ? <p className="text-sm text-zinc-400">{agent.description}</p> : null}

        <dl className="grid grid-cols-2 gap-4">
          <Field label="Role">
            {agent.role ?? <span className="text-zinc-600">— not recorded</span>}
          </Field>
          <Field label="Runtime">{agent.runtime ?? UNAVAILABLE}</Field>
          <Field label="Model">
            {agent.model ? <span className="font-mono text-xs">{agent.model}</span> : UNAVAILABLE}
          </Field>
          <Field label="Last activity">
            {age ? (
              <span title={agent.lastActivityAt ?? undefined}>{age}</span>
            ) : (
              // NOT an unconditional "no run recorded": that sentence is a
              // positive claim, and it is only true when the runs were read.
              <span className="text-zinc-600">— {lastActivityFallback(agent.runHistory)}</span>
            )}
          </Field>
        </dl>

        <div>
          <Subheading level={3} tone="neutral" className={panelSectionTitleClass}>
            Metrics
          </Subheading>
          <dl className="mt-3 grid grid-cols-3 gap-4">
            {agent.metrics.map((metric) => (
              <div key={metric.key} className="flex flex-col gap-1">
                <dt className="text-xs text-zinc-500">{metric.label}</dt>
                <dd className="font-mono text-sm tabular-nums text-white">
                  {metric.value ?? <span className="text-zinc-600">n/a</span>}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <Subheading level={3} tone="neutral" className={panelSectionTitleClass}>
            Tools
          </Subheading>
          {/* Checked FIRST: a failed tool read also produces an empty array, so
              testing `length === 0` alone turns an exception into the assertion
              "No tool declared." */}
          {agent.toolsUnavailable ? (
            <p className="mt-2 text-sm text-zinc-400">
              — tools could not be read. This is not a statement that none is declared.
            </p>
          ) : agent.tools.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {agent.tools.map((tool) => (
                <li key={tool}>
                  <Badge color="zinc">
                    <span className="font-mono text-xs">{tool}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-zinc-400">No tool declared.</p>
          )}
        </div>

        <Divider soft />

        <div className="flex items-center justify-between gap-3">
          <Subheading level={3} tone="neutral" className={panelSectionTitleClass}>
            Relations
          </Subheading>
          {canAddRelation ? (
            <Button ref={addRelationRef} outline onClick={onAddRelation}>
              Add relation
            </Button>
          ) : null}
        </div>

        {derivedOnly ? (
          <p className="text-xs text-zinc-500">
            Every relation below was <strong className="font-medium text-zinc-400">derived</strong> from
            observable evidence (shared tools, mission participation, project membership). None of them
            is a relation someone configured.
          </p>
        ) : null}

        <div>
          <Subheading level={3} tone="neutral" className={panelSectionTitleClass}>
            Incoming relations
          </Subheading>
          {incoming.length > 0 ? (
            <ul className="mt-2 divide-y divide-white/5">
              {incoming.map((edge) => (
                <RelationRow
                  key={edge.id}
                  edge={edge}
                  counterpart={nodesById.get(edge.source)}
                  direction="in"
                  agentName={agent.name}
                  now={now}
                  onDelete={onDeleteRelation}
                />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-zinc-400">
              No incoming relation is configured or derivable for this agent.
            </p>
          )}
        </div>

        <div>
          <Subheading level={3} tone="neutral" className={panelSectionTitleClass}>
            Outgoing relations
          </Subheading>
          {outgoing.length > 0 ? (
            <ul className="mt-2 divide-y divide-white/5">
              {outgoing.map((edge) => (
                <RelationRow
                  key={edge.id}
                  edge={edge}
                  counterpart={nodesById.get(edge.target)}
                  direction="out"
                  agentName={agent.name}
                  now={now}
                  onDelete={onDeleteRelation}
                />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-zinc-400">
              No outgoing relation is configured or derivable for this agent.
            </p>
          )}
        </div>

        {agent.latestRunId ? (
          <div>
            <Subheading level={3} tone="neutral" className={panelSectionTitleClass}>
              Recent run
            </Subheading>
            <p className="mt-2 text-sm text-zinc-300">
              {humanizeStatus(agent.latestRunStatus ?? 'unavailable')}
              <span className="ml-2 font-mono text-xs text-zinc-500">{agent.latestRunId}</span>
            </p>
          </div>
        ) : null}

        {agentLinks.length > 0 ? (
          <div className="flex flex-col gap-2">
            {agentLinks.map(({ label, href }) => (
              <Link
                key={label}
                href={href}
                className="flex items-center justify-between rounded-lg border border-white/5 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
              >
                {label}
                <ArrowTopRightOnSquareIcon aria-hidden="true" className="size-4 text-zinc-500" />
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
