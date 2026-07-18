'use client'

import clsx from 'clsx'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  const stats: TeamStat[] = summary
    ? [
        { name: 'Agents', value: String(summary.totalAgents) },
        { name: 'Active', value: String(summary.activeAgents), accent: true },
        { name: 'Waiting', value: String(summary.waitingAgents) },
        { name: 'Blocked', value: String(summary.blockedAgents) },
        { name: 'Failed', value: String(summary.failedAgents) },
        { name: 'Runs today', value: String(summary.runsToday) },
      ]
    : []

  // --- aria-live announcement -----------------------------------------------
  // Derived during render, not pushed from an effect: the refresh hook only
  // swaps the graph when the payload REALLY changed (`changeToken`), so this
  // string is stable across identical polls and the live region stays silent.
  const announcement =
    changeToken > 0 && summary
      ? `Team updated. ${summary.activeAgents} active, ${summary.waitingAgents} waiting, ${summary.blockedAgents} blocked, ${summary.failedAgents} failed.`
      : ''

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

  // No graph at all = fail-closed. Either the server said why (`loadError`), or
  // the poll has not produced one yet — in both cases we state it plainly
  // rather than render an approximation.
  if (!graph) {
    return (
      <div className={surfaceCardClass}>
        <ProjectTeamUnavailableState
          detail={
            loadError ??
            'No team graph could be loaded for this project. Nothing is drawn rather than an approximate graph. Refresh, and check the agent-ops backend if it persists.'
          }
        />
      </div>
    )
  }

  if (agents.length === 0) {
    return (
      <div className={surfaceCardClass}>
        <ProjectTeamNoAgentsEmptyState projectId={projectId} />
      </div>
    )
  }

  const filtersActive = hasActiveFilters(filters)
  const nothingMatches = visibleAgents.length === 0
  // A team with agents but no relation beyond plain project membership is a
  // real, common state. We say so instead of drawing a network that isn't there.
  const onlyMembership =
    allEdges.length > 0 &&
    allEdges.every((edge) => edge.relation === 'project-membership' || edge.relation === 'team-membership')

  return (
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
              className="h-[60vh] min-h-96 w-full lg:h-[calc(100svh-26rem)]"
            />
          )}

          {selectedAgent ? (
            <ProjectTeamPanel
              agent={selectedAgent}
              incoming={incoming}
              outgoing={outgoing}
              nodesById={nodesById}
              onClose={() => selectAgent(null)}
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

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
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
