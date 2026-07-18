'use client'

import clsx from 'clsx'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { surfaceCardClass } from '@/components/agent-ops/surface-card'
import type { ProjectTeamGraph } from '@/lib/agent-mission-control/project-team/types'
import { ProjectTeamAccessibleList } from './project-team-accessible-list'
import { ProjectTeamCanvas } from './project-team-canvas'
import {
  ProjectTeamNoAgentsEmptyState,
  ProjectTeamNoMatchEmptyState,
  ProjectTeamUnavailableState,
} from './project-team-empty-state'
import {
  ProjectTeamPanel,
  formatAge,
  humanizeStatus,
  readGraphEdges,
  readGraphFreshness,
  readGraphNodes,
  toTeamAgentView,
  toTeamEdgeView,
  type TeamAgentView,
  type TeamEdgeView,
} from './project-team-panel'
import { AddRelationDialog, DeleteRelationDialog } from './project-team-relation-dialogs'
import {
  CANVAS_COMMAND_EVENT,
  EMPTY_FILTERS,
  ProjectTeamToolbar,
  VIEW_MODES,
  hasActiveFilters,
  type CanvasCommand,
  type ProjectTeamFilters,
  type ProjectTeamViewMode,
} from './project-team-toolbar'
import { useProjectTeamRefresh } from './use-project-team-refresh'

function isViewMode(value: string | null): value is ProjectTeamViewMode {
  return VIEW_MODES.some((mode) => mode.value === value)
}

/** One number on the compact summary strip above the canvas. */
interface TeamStat {
  name: string
  value: string
  /** Only "Active" carries the accent — the single non-neutral hue on screen. */
  accent?: boolean
}

/**
 * A count the backend could not read renders as an em dash, never as 0 and
 * never as the string "null". "0 runs today" and "we don't know how many runs
 * today" are different facts and an operator must be able to tell them apart.
 */
function formatCount(value: number | null | undefined): string {
  return typeof value === 'number' ? String(value) : '—'
}

function matches(agent: TeamAgentView, filters: ProjectTeamFilters): boolean {
  // AND composition. Each clause is a no-op when its control is at "all"/empty,
  // so adding a filter can only ever shrink the visible set — never widen it.
  const query = filters.query.trim().toLowerCase()
  if (query) {
    const haystack = `${agent.name} ${agent.role ?? ''}`.toLowerCase()
    if (!haystack.includes(query)) return false
  }
  if (filters.status !== 'all' && agent.status !== filters.status) return false
  if (filters.runtime !== 'all' && (agent.runtime ?? '') !== filters.runtime) return false
  if (filters.team !== 'all' && (agent.team ?? '') !== filters.team) return false
  return true
}

function ProjectTeamViewInner({
  projectId,
  initialGraph,
  loadError,
}: {
  projectId: string
  initialGraph: ProjectTeamGraph | null
  /** Precise operator-facing reason the server could not produce a graph. */
  loadError: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const { graph, stale, lastSyncedAt, changeToken, refreshNow } = useProjectTeamRefresh(
    projectId,
    initialGraph
  )

  const [filters, setFilters] = useState<ProjectTeamFilters>(EMPTY_FILTERS)

  // --- Relation mutation dialogs --------------------------------------------
  // Both dialogs own their own request/error state; this view owns only
  // whether they are open and what they act on. AC-8: neither dialog ever
  // mutates `graph` directly — `onDone` is always `refreshNow`, so the canvas
  // only ever draws what the server just confirmed.
  /**
   * The agent the create-relation dialog was opened for — the full node, not a
   * bare "is it open" boolean and not an id either.
   *
   * As a boolean it was cleared only by `onClose`, so when a 10s poll returned
   * a graph without the selected agent the dialog unmounted with the flag still
   * `true`, and the next click on ANY other node sprang it open unrequested.
   * Keying it by id fixed the wrong-node part but not the latch: an id whose
   * agent a poll had dropped still survived in state, and if that agent came
   * back in a later poll (membership flapping, a partial backend read) the
   * dialog re-opened on its own.
   *
   * Holding the NODE fixes both at once, and is the same shape as
   * `pendingDelete` for the same reason: the dialog is mounted on this payload
   * rather than on the selection, so it cannot be opened against a node the
   * operator did not pick, cannot outlive its own close (nothing else clears
   * it, and nothing else needs to), and — the point of G5 — cannot be
   * unmounted mid-submit by a selection change. The `kind === 'agent'` gate is
   * enforced where this is SET, from `relationSource`, so a hub or a group can
   * never get in here.
   */
  const [addRelationSource, setAddRelationSource] = useState<TeamAgentView | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ relationId: string; description: string } | null>(null)
  /**
   * One-shot spoken confirmation of a relation write. It needs its own state
   * because the graph-derived announcement below is built from `summary` AGENT
   * counts only — creating or deleting a relation moves none of them, so that
   * string is byte-identical before and after and a screen-reader user was told
   * nothing at all. `seq` keys the rendered node so that two identical messages
   * in a row (delete, undo, delete again) still re-announce.
   */
  const [relationNotice, setRelationNotice] = useState<{ message: string; seq: number } | null>(null)
  const announceRelation = useCallback(
    (message: string) => setRelationNotice((prev) => ({ message, seq: (prev?.seq ?? 0) + 1 })),
    []
  )
  /** Focus lands here after a delete — the row's `×` is gone by then. */
  const addRelationRef = useRef<HTMLElement | null>(null)
  const [restoreFocusAfterDelete, setRestoreFocusAfterDelete] = useState(false)

  // --- URL is the source of truth for selection + view mode, so a copied link
  //     reopens EXACTLY the same picture. `replace` (not `push`) keeps the back
  //     button meaningful instead of stacking one entry per node click.
  const selectedAgentId = searchParams.get('agent')
  const viewParam = searchParams.get('view')
  const viewMode: ProjectTeamViewMode = isViewMode(viewParam) ? viewParam : 'structure'

  const writeParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString())
      mutate(params)
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  const selectAgent = useCallback(
    (agentId: string | null) => {
      writeParams((params) => {
        if (agentId) params.set('agent', agentId)
        else params.delete('agent')
      })
    },
    [writeParams]
  )

  const setViewMode = useCallback(
    (mode: ProjectTeamViewMode) => {
      writeParams((params) => {
        if (mode === 'structure') params.delete('view')
        else params.set('view', mode)
      })
    },
    [writeParams]
  )

  // --- Derived model -------------------------------------------------------
  const allNodes = useMemo(() => readGraphNodes(graph).map(toTeamAgentView), [graph])
  const allEdges = useMemo<TeamEdgeView[]>(() => readGraphEdges(graph).map(toTeamEdgeView), [graph])
  const agents = useMemo(() => allNodes.filter((node) => node.kind === 'agent'), [allNodes])
  /** Project hub + group nodes: structural scaffolding, never filtered away. */
  const structuralIds = useMemo(
    () => allNodes.filter((node) => node.kind !== 'agent').map((node) => node.id),
    [allNodes]
  )

  const visibleAgents = useMemo(() => agents.filter((agent) => matches(agent, filters)), [agents, filters])
  const visibleIds = useMemo(
    () => [...structuralIds, ...visibleAgents.map((agent) => agent.id)],
    [structuralIds, visibleAgents]
  )

  const nodesById = useMemo(() => new Map(allNodes.map((node) => [node.id, node])), [allNodes])
  const selectedAgent = selectedAgentId ? nodesById.get(selectedAgentId) : undefined

  /**
   * The selected node ONLY when it is a legal relation source.
   *
   * Relations are agent-to-agent (`sourceCopilotId`/`targetCopilotId`), so a
   * project hub (`project:<id>`) or a tag-derived group is never one. The panel
   * already gates its "Add relation" button on `kind === 'agent'`, and this is
   * the other half of that guarantee: it is the ONLY expression that can put a
   * node into `addRelationSource`, so the dialog can never render against a hub
   * and POST `sourceCopilotId: "project:<id>"`. The server would correctly
   * answer 422, but "never offer what will be rejected" has to be enforced
   * here, not left to the server.
   */
  const relationSource = selectedAgent?.kind === 'agent' ? selectedAgent : null

  // Target picker for "Add relation": every agent of this project except the
  // dialog's own source — self-edges are rejected server-side and are never
  // even offered here. Derived from the LIVE `agents` list rather than
  // snapshotted with the source, so the dialog sees an agent leave the project
  // and can retract a selection that no longer exists.
  const candidateAgents = useMemo(
    () => (addRelationSource ? agents.filter((candidate) => candidate.id !== addRelationSource.id) : []),
    [agents, addRelationSource]
  )

  /**
   * Both dialogs are now mounted on their own payload, never on the selection.
   *
   * That is what lets either survive a selection change mid-submit: pressing
   * browser Back drops the `agent` search param, but neither dialog is gated on
   * it, so a pending `setError`/`onDone` still lands on a live component and
   * the operator is told what happened. It also removes the latch entirely —
   * there is no state that can outlive its dialog and re-attach to another
   * node, because the state IS the dialog's mount condition.
   */
  const addRelationOpen = addRelationSource !== null

  /**
   * True exactly while a Headless portal dialog is on screen. Both DOM-scoped
   * behaviours in the panel (focus trap, Escape) stand down on this — see the
   * `dialogOpen` prop there for why a portal defeats each of them.
   */
  const relationDialogOpen = addRelationOpen || pendingDelete !== null

  const incoming = useMemo(
    () => (selectedAgent ? allEdges.filter((edge) => edge.target === selectedAgent.id) : []),
    [allEdges, selectedAgent]
  )
  const outgoing = useMemo(
    () => (selectedAgent ? allEdges.filter((edge) => edge.source === selectedAgent.id) : []),
    [allEdges, selectedAgent]
  )

  // Filter options come from the agents actually present — never a hardcoded
  // enum listing states this project has never had.
  const statusOptions = useMemo(
    () =>
      [...new Set(agents.map((a) => a.status))]
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: humanizeStatus(value) })),
    [agents]
  )
  const runtimeOptions = useMemo(
    () =>
      [...new Set(agents.map((a) => a.runtime).filter((v): v is string => Boolean(v)))]
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value })),
    [agents]
  )
  const teamOptions = useMemo(
    () =>
      [...new Set(agents.map((a) => a.team).filter((v): v is string => Boolean(v)))]
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value })),
    [agents]
  )

  // --- KPIs — read straight off the contract's `summary`, which the data layer
  //     computed from persisted rows. Nothing is recounted client-side, so the
  //     band cannot drift from the graph it sits above.
  const summary = graph?.summary ?? null
  const freshness = readGraphFreshness(graph)
  const freshnessAge = formatAge(lastSyncedAt ?? freshness)

  // Rendered as ONE compact inline strip, not a KPI band: on this screen the
  // canvas is the product and every pixel above it is taken from the graph. The
  // numbers stay legible and complete, they just stop being a wall of tiles.
  // The activity counters are nullable BY DESIGN: null means "not countable"
  // (at least one agent's runs were unreadable), which is a different fact from
  // a measured 0. Publishing 0 would fabricate a count and publishing the
  // countable subset would publish a floor as if it were a total — both are
  // wrong numbers. `formatCount` renders the unknown as an em dash, never as
  // "0" and never as the literal string "null" (`String(null)` compiles fine,
  // so TypeScript will NOT catch that mistake here).
  const stats: TeamStat[] = summary
    ? [
        { name: 'Agents', value: String(summary.totalAgents) },
        { name: 'Active', value: formatCount(summary.activeAgents), accent: true },
        { name: 'Waiting', value: formatCount(summary.waitingAgents) },
        { name: 'Blocked', value: formatCount(summary.blockedAgents) },
        { name: 'Failed', value: formatCount(summary.failedAgents) },
        { name: 'Runs today', value: formatCount(summary.runsToday) },
        // Shown only when it is non-zero: it is the number that EXPLAINS why the
        // counters above are dashes, so hiding it would leave the dashes
        // unexplained. At zero it is noise.
        ...(summary.unavailableAgents > 0
          ? [{ name: 'Unavailable', value: String(summary.unavailableAgents) }]
          : []),
      ]
    : []

  // --- aria-live announcement -----------------------------------------------
  // Derived during render, not pushed from an effect: the refresh hook only
  // swaps the graph when the payload REALLY changed (`changeToken`), so this
  // string is stable across identical polls and the live region stays silent.
  // Never speak "null" at a screen-reader user, and never speak a fabricated
  // zero either: when the statuses are not countable, say exactly that.
  const announcement =
    changeToken > 0 && summary
      ? summary.activeAgents === null
        ? `Team updated. Agent statuses are unavailable for ${summary.unavailableAgents} of ${summary.totalAgents} agents.`
        : `Team updated. ${summary.activeAgents} active, ${summary.waitingAgents} waiting, ${summary.blockedAgents} blocked, ${summary.failedAgents} failed.`
      : ''

  /**
   * Put focus somewhere real after a delete.
   *
   * The element that had focus was the row's `×`, and the refresh that follows
   * EITHER delete outcome — the row was actually removed, or the server said
   * it was already gone — removes that row from the graph just the same;
   * focus then falls to `<body>` and a keyboard user restarts from the top of
   * the document. Headless restores focus to its saved trigger as it closes,
   * but that trigger is exactly the button about to disappear, so its restore
   * lands on `<body>` too.
   *
   * The rAF is what makes this win: Headless restores synchronously in its
   * unmount cleanup (the dialog is hard-unmounted by the `pendingDelete` gate,
   * so the leave transition never plays), while this runs after the next paint
   * — strictly later. Guarded on the dialog actually being gone so it cannot
   * fire while the dialog still owns focus.
   */
  useEffect(() => {
    if (!restoreFocusAfterDelete || pendingDelete !== null) return
    const frame = requestAnimationFrame(() => {
      addRelationRef.current?.focus()
      setRestoreFocusAfterDelete(false)
    })
    return () => cancelAnimationFrame(frame)
  }, [restoreFocusAfterDelete, pendingDelete])

  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), [])

  // --- Toolbar → canvas viewport bridge ------------------------------------
  // The canvas mounts its own ReactFlowProvider, so `useReactFlow()` here would
  // reach a different (empty) context. Instead we drive the canvas's REAL
  // React Flow controls, which it already renders — no duplicated viewport
  // state, no second source of truth for zoom/fit.
  const canvasHostRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const SELECTORS: Record<CanvasCommand, string> = {
      fit: '.react-flow__controls-fitview',
      recenter: '.react-flow__controls-fitview',
      'zoom-in': '.react-flow__controls-zoomin',
      'zoom-out': '.react-flow__controls-zoomout',
    }
    function onCommand(event: Event) {
      const command = (event as CustomEvent<CanvasCommand>).detail
      // "Recenter" means "show me the whole team again", so it also drops the
      // current selection — that is what distinguishes it from a plain fit.
      if (command === 'recenter') selectAgent(null)
      canvasHostRef.current?.querySelector<HTMLElement>(SELECTORS[command])?.click()
    }
    window.addEventListener(CANVAS_COMMAND_EVENT, onCommand)
    return () => window.removeEventListener(CANVAS_COMMAND_EVENT, onCommand)
  }, [selectAgent])

  /**
   * The two relation dialogs, built ONCE here and rendered from a SINGLE shared
   * shell — the unified Fragment at the very end of this component — at a fixed
   * child position common to all three render states (the unavailable card, the
   * no-agents empty state, and the main graph).
   *
   * Rendering the dialogs in every branch is NECESSARY but was not SUFFICIENT
   * on its own. React's reconciler pairs children by POSITION and tears a
   * subtree down whenever the element TYPE at that position changes. The
   * earlier shape returned a `<div>` from the main branch and a Fragment `<>`
   * from the two early returns, so every main⟷empty flip changed the ROOT
   * element type and rebuilt the entire tree — dialog included — no matter
   * where inside the branch the dialog sat. A 10s poll that returned a graph
   * with zero agent nodes (a truthful data state) therefore unmounted a dialog
   * WITH ITS POST IN FLIGHT: the dialog-local `setError`/`onDone` then landed
   * on an unmounted instance (a silent no-op in React 19) and the operator was
   * never told whether the row was written — precisely the outcome the dialogs'
   * own dismissal veto (`closeUnlessSaving`) exists to make unreachable. It
   * also brought the latch back: neither piece of state is cleared by that
   * transition, so a later poll that returned agents again sprang a fresh blank
   * dialog open unrequested, against a stale captured source or a relation id
   * with no backing row.
   *
   * The actual fix is the unified root: ALL three branches now return
   * `<>{branchContent}{relationAnnouncer}{relationDialogs}</>` with identical
   * child count and order, so `relationDialogs` sits at the same position with
   * the same element type across every transition and React PRESERVES its
   * subtree instead of rebuilding it — a dialog with its POST in flight is
   * never torn down. The payload (`addRelationSource` / `pendingDelete`) stays
   * the only mount condition, and only its own `onClose` ever clears it;
   * clearing the state on a branch flip would just be the mid-submit unmount
   * again, by hand.
   *
   * Everything read here (`candidateAgents` included) is derived above, so
   * nothing moved below a conditional return and no hook order changed.
   */
  const relationDialogs = (
    <>
      {/* Mounted on the captured source, NOT on the selection — a hub or a
          group can never reach this state (see `relationSource`), and a
          selection that changes mid-submit can no longer unmount the dialog
          out from under its own pending request. Keyed by source id so that
          each open is a genuinely fresh form rather than a reused instance
          carrying the previous attempt's fields. */}
      {addRelationSource ? (
        <AddRelationDialog
          key={addRelationSource.id}
          projectId={projectId}
          sourceAgent={addRelationSource}
          candidates={candidateAgents}
          open={addRelationOpen}
          onClose={() => setAddRelationSource(null)}
          onDone={() => {
            // Spoken BEFORE the re-fetch, and phrased as what the server already
            // confirmed — the dialog only calls `onDone` on a 2xx. It does not
            // claim the canvas is redrawn; that is the refresh's job.
            announceRelation(`Relation added from ${addRelationSource.name}. Refreshing the team graph.`)
            refreshNow()
          }}
        />
      ) : null}

      {pendingDelete ? (
        <DeleteRelationDialog
          projectId={projectId}
          relationId={pendingDelete.relationId}
          description={pendingDelete.description}
          open
          onClose={() => setPendingDelete(null)}
          onDone={(outcome) => {
            // The 404 path reaches here too, and it did NOT delete anything.
            // Announcing it as a delete contradicts the `role="alert"` the
            // operator can see, and tells a screen-reader user their action
            // succeeded when it removed nothing — so the wording stays split.
            //
            // The FOCUS restore is not split, because both outcomes end the
            // same way for the keyboard: the refresh either drops the edge or
            // nulls its `relationId`, so the row's `×` — the element Headless
            // saved as its restore target when the dialog opened — is gone by
            // the time the dialog closes, and restoring to a detached node is
            // a no-op that drops focus to `<body>`. Arming it on the 404 does
            // NOT latch it: the effect above early-returns while
            // `pendingDelete !== null` (this dialog deliberately stays open
            // there), then runs on close and clears the flag — a deferred
            // restore, not a stuck one. Nor does it steal focus for no reason:
            // the row it would otherwise return to no longer exists, and the
            // only alternative is `<body>`.
            if (outcome === 'deleted') {
              announceRelation(`Relation deleted: ${pendingDelete.description}. Refreshing the team graph.`)
            } else {
              announceRelation(
                `This relation no longer exists: ${pendingDelete.description}. It was already removed — refreshing the team graph.`
              )
            }
            setRestoreFocusAfterDelete(true)
            refreshNow()
          }}
        />
      ) : null}
    </>
  )

  /**
   * The relation-write announcement, mounted next to `relationDialogs` for the
   * same reason and by the same rule: a create/delete that completes its
   * request while a poll has just flipped this component to the unavailable
   * or no-agents branch must still reach a screen reader — `announceRelation`
   * does not know or care which branch is about to render.
   *
   * The graph-derived `announcement` below (agent-status counts off `summary`)
   * is deliberately NOT part of this region: hoisting it too would speak a
   * count of agents in branches that render because there IS no such count
   * (`!graph`) or because it is zero (`agents.length === 0`), which changes
   * what those two states announce. That string stays put, alone, in the main
   * return's own live region — this is a second, sibling region carrying only
   * the relation string, not a replacement for it.
   */
  const relationAnnouncer = (
    <div aria-live="polite" className="sr-only">
      <span key={relationNotice?.seq ?? 0}>{relationNotice?.message ?? ''}</span>
    </div>
  )

  // The three render states share ONE root shell — the Fragment at the end of
  // this component: `<>{branchContent}{relationAnnouncer}{relationDialogs}</>`,
  // identical in child count and order across all three. That shared shape is
  // what actually preserves the dialog subtree across a poll-driven branch flip
  // (see `relationDialogs` above); three separate returns with different root
  // element types do NOT — React remounts on a root-type change and tears an
  // in-flight dialog down. `branchContent` is a SINGLE element per branch,
  // holding EXACTLY what that state rendered before, and the graph-derived
  // aria-live region stays INSIDE the main branch's content so the shared child
  // positions line up (exactly three children in every branch).
  let branchContent: ReactNode

  // No graph at all = fail-closed. Either the server said why (`loadError`), or
  // the poll has not produced one yet — in both cases we state it plainly
  // rather than render an approximation.
  if (!graph) {
    branchContent = (
      <div className={surfaceCardClass}>
        <ProjectTeamUnavailableState
          detail={
            loadError ??
            'No team graph could be loaded for this project. Nothing is drawn rather than an approximate graph. Refresh, and check the agent-ops backend if it persists.'
          }
        />
      </div>
    )
  } else if (agents.length === 0) {
    branchContent = (
      <div className={surfaceCardClass}>
        <ProjectTeamNoAgentsEmptyState projectId={projectId} />
      </div>
    )
  } else {
    const filtersActive = hasActiveFilters(filters)
    const nothingMatches = visibleAgents.length === 0
    // A team with agents but no relation beyond plain project membership is a
    // real, common state. We say so instead of drawing a network that isn't there.
    const onlyMembership =
      allEdges.length > 0 &&
      allEdges.every((edge) => edge.relation === 'project-membership' || edge.relation === 'team-membership')

    branchContent = (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* Summary + freshness on a single hairline row — uncaged, ~1 line tall,
            so the graph below starts as high up the viewport as possible. */}
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs">
          {stats.map((stat) => (
            <span key={stat.name} className="flex items-baseline gap-1.5">
              <span
                className={clsx(
                  'font-mono text-sm font-medium tabular-nums',
                  stat.accent ? 'text-accent-400' : 'text-white'
                )}
              >
                {stat.value}
              </span>
              <span className="text-zinc-500">{stat.name}</span>
            </span>
          ))}
          <span className="ml-auto text-zinc-500">
            {freshnessAge ? `Refreshed ${freshnessAge}` : 'Freshness unavailable'}
            {stale ? ' · last refresh failed, showing the previous graph' : null}
          </span>
        </div>

        <div className={clsx(surfaceCardClass, 'flex min-h-0 flex-1 flex-col')}>
          <ProjectTeamToolbar
            filters={filters}
            onFiltersChange={setFilters}
            statusOptions={statusOptions}
            runtimeOptions={runtimeOptions}
            teamOptions={teamOptions}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onClearFilters={clearFilters}
            onRefresh={refreshNow}
            visibleCount={visibleAgents.length}
            totalCount={agents.length}
          />

          {onlyMembership ? (
            <p className="border-b border-white/5 px-4 py-2 text-xs text-zinc-500">
              No orchestration or dependency relation is recorded for this team yet — the links below are
              project and team membership only.
            </p>
          ) : null}

          {/* The canvas is the dominant surface; the panel overlays it (absolute)
              so selecting a node never reflows or shrinks the graph. */}
          <div ref={canvasHostRef} className="relative flex min-h-0 flex-1 flex-col">
            {nothingMatches ? (
              <ProjectTeamNoMatchEmptyState onClearFilters={clearFilters} />
            ) : (
              <ProjectTeamCanvas
                graph={graph}
                selectedAgentId={selectedAgentId}
                onSelectAgent={selectAgent}
                viewMode={viewMode}
                filteredNodeIds={filtersActive ? visibleIds : undefined}
                // Height comes from the flex chain (main is h-svh, every ancestor
                // is flex-1/min-h-0), NOT from an arithmetic guess about how tall
                // the chrome above happens to be: a `calc(100svh - Nrem)` silently
                // breaks the day the header or toolbar wraps to another line.
                // `min-h-96` is the floor for short viewports.
                className="min-h-96 w-full flex-1"
              />
            )}

            {selectedAgent ? (
              <ProjectTeamPanel
                agent={selectedAgent}
                incoming={incoming}
                outgoing={outgoing}
                nodesById={nodesById}
                onClose={() => selectAgent(null)}
                onAddRelation={() => setAddRelationSource(relationSource)}
                onDeleteRelation={(relationId, description) => setPendingDelete({ relationId, description })}
                dialogOpen={relationDialogOpen}
                addRelationRef={addRelationRef}
              />
            ) : null}
          </div>

          {/* Same visible agents, as a semantic list: shown for real on small
              viewports (the feature is never hidden on mobile), screen-reader-only
              from `lg` up where the canvas carries the visual job. */}
          <ProjectTeamAccessibleList
            agents={visibleAgents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={selectAgent}
            className="border-t border-white/5 lg:sr-only lg:border-t-0"
          />
        </div>

        {/* The graph's own periodic update, off `summary` — main-branch only,
            so it stays INSIDE this branch content (see `relationAnnouncer`
            above for why it is not hoisted into the shared shell). The
            operator's own relation write lives in the sibling
            `relationAnnouncer` region of that shell, rendered just after this
            content and common to all three branches, so neither string can mask
            the other: a persistent "Relation added." must not silence the next
            real status change, and a poll must not erase the confirmation the
            operator just earned. */}
        <div aria-live="polite" className="sr-only">
          <span>{announcement}</span>
        </div>
      </div>
    )
  }

  return (
    <>
      {branchContent}
      {relationAnnouncer}
      {relationDialogs}
    </>
  )
}

/**
 * `useSearchParams` suspends during static rendering, so the URL-synced shell
 * is wrapped here rather than at every call site.
 */
export function ProjectTeamView(props: {
  projectId: string
  initialGraph: ProjectTeamGraph | null
  loadError: string | null
}) {
  return (
    <Suspense fallback={<div className={clsx(surfaceCardClass, 'min-h-96')} aria-busy="true" />}>
      <ProjectTeamViewInner {...props} />
    </Suspense>
  )
}
