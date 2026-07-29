import type { AgentRun, AgentRunStatus } from '@/lib/agent-mission-control/types'

/**
 * AIGENT-FRONTEND-RESET-001 — the ONE filtering path for the global runs
 * cockpit. The server page parses the URL with `parseRunsFilters`, the client
 * view re-applies the SAME `applyRunsFilters` over the loaded dataset, and the
 * KPI band, success ring, table and activity panel all read that single
 * filtered array. No second implementation of "which runs count".
 */

export const RUN_STATUSES = [
  'completed',
  'running',
  'failed',
  'blocked',
  'needs-confirmation',
] as const satisfies readonly AgentRunStatus[]

/**
 * Period options are SUB-WINDOWS of the 24h window the loader already reads
 * (see runs-page-data.ts). They narrow an in-memory dataset — they never claim
 * to reach further back than what was loaded, which is why there is no "7d"
 * option: the data layer's operational window is 24h and inventing a longer
 * label would show an empty range as if it were a measured absence.
 */
export const RUNS_PERIODS = ['1h', '6h', '24h'] as const
export type RunsPeriod = (typeof RUNS_PERIODS)[number]

export const PERIOD_MS: Record<RunsPeriod, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
}

export interface RunsFilterState {
  q: string
  agent: string
  project: string
  status: string
  period: RunsPeriod
}

export const DEFAULT_RUNS_FILTERS: RunsFilterState = {
  q: '',
  agent: '',
  project: '',
  status: '',
  period: '24h',
}

function isPeriod(value: string): value is RunsPeriod {
  return (RUNS_PERIODS as readonly string[]).includes(value)
}

function isStatus(value: string): value is AgentRunStatus {
  return (RUN_STATUSES as readonly string[]).includes(value)
}

/** Accepts Next.js `searchParams` (string | string[] | undefined values). */
export type RawSearchParams = Record<string, string | string[] | undefined>

function firstValue(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? ''
  return raw ?? ''
}

/**
 * URL → filter state. Unknown/By-hand values fall back to the default rather
 * than filtering everything out: a hand-edited `?status=banana` shows the full
 * list (and the Status select reads "All"), never a silently empty table that
 * looks like "no runs exist".
 */
export function parseRunsFilters(params: RawSearchParams | undefined): RunsFilterState {
  if (!params) return { ...DEFAULT_RUNS_FILTERS }

  const period = firstValue(params.period)
  const status = firstValue(params.status)

  return {
    q: firstValue(params.q).slice(0, 200),
    agent: firstValue(params.agent),
    project: firstValue(params.project),
    status: isStatus(status) ? status : '',
    period: isPeriod(period) ? period : DEFAULT_RUNS_FILTERS.period,
  }
}

/** Filter state → querystring. Defaults are omitted so a clean view has a clean URL. */
export function serializeRunsFilters(state: RunsFilterState): string {
  const params = new URLSearchParams()
  if (state.q.trim()) params.set('q', state.q.trim())
  if (state.agent) params.set('agent', state.agent)
  if (state.project) params.set('project', state.project)
  if (state.status) params.set('status', state.status)
  if (state.period !== DEFAULT_RUNS_FILTERS.period) params.set('period', state.period)
  return params.toString()
}

export function hasActiveFilters(state: RunsFilterState): boolean {
  return (
    Boolean(state.q.trim()) ||
    Boolean(state.agent) ||
    Boolean(state.project) ||
    Boolean(state.status) ||
    state.period !== DEFAULT_RUNS_FILTERS.period
  )
}

export interface RunsFilterContext {
  /** copilotId → display name, for search-by-agent-name. */
  agentNameById: Map<string, string>
  /** projectId → display name, for search-by-project-name. */
  projectNameById: Map<string, string>
  /** Render instant the period window is measured from (injected, never Date.now() inside). */
  nowMs: number
}

/**
 * Search matches run id, agent name, project name and input summary — the four
 * fields the mission names. Case-insensitive substring, no fuzzy scoring: an
 * operator pasting a run id must get that exact row, not a ranked guess.
 */
function matchesQuery(run: AgentRun, query: string, ctx: RunsFilterContext): boolean {
  const agentName = ctx.agentNameById.get(run.copilotId) ?? ''
  const projectName = run.projectId ? (ctx.projectNameById.get(run.projectId) ?? '') : ''
  const haystack = `${run.id} ${agentName} ${projectName} ${run.inputSummary}`.toLowerCase()
  return haystack.includes(query)
}

export function applyRunsFilters(
  runs: AgentRun[],
  state: RunsFilterState,
  ctx: RunsFilterContext
): AgentRun[] {
  const query = state.q.trim().toLowerCase()
  const since = ctx.nowMs - PERIOD_MS[state.period]

  return runs.filter((run) => {
    if (state.agent && run.copilotId !== state.agent) return false
    if (state.project && run.projectId !== state.project) return false
    if (state.status && run.status !== state.status) return false

    const startedMs = Date.parse(run.startedAt)
    // An unparseable timestamp is kept rather than dropped: hiding a row because
    // its date is malformed would under-report the fleet without saying so.
    if (Number.isFinite(startedMs) && startedMs < since) return false

    if (query && !matchesQuery(run, query, ctx)) return false
    return true
  })
}
