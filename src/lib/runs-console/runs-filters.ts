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

/**
 * Duration buckets over `AgentRun.latencyMs`. A run with no finite latency
 * matches NONE of them — it is unmeasured, not "under 1s" — so it only shows
 * up when no duration filter is active.
 */
export const RUNS_DURATIONS = ['lt1s', '1to10s', 'gt10s'] as const
export type RunsDuration = (typeof RUNS_DURATIONS)[number]

/** Over `AgentRun.costUsd`: `measured` = not null, `unmeasured` = null. */
export const RUNS_COSTS = ['measured', 'unmeasured'] as const
export type RunsCost = (typeof RUNS_COSTS)[number]

export interface RunsFilterState {
  q: string
  agent: string
  project: string
  status: string
  period: RunsPeriod
  /** Exact match against `AgentRun.resolvedProvider`. Empty = all. */
  provider: string
  /** Exact match against `AgentRun.resolvedModel`. Empty = all. */
  model: string
  duration: RunsDuration | ''
  cost: RunsCost | ''
}

export const DEFAULT_RUNS_FILTERS: RunsFilterState = {
  q: '',
  agent: '',
  project: '',
  status: '',
  period: '24h',
  provider: '',
  model: '',
  duration: '',
  cost: '',
}

function isPeriod(value: string): value is RunsPeriod {
  return (RUNS_PERIODS as readonly string[]).includes(value)
}

function isStatus(value: string): value is AgentRunStatus {
  return (RUN_STATUSES as readonly string[]).includes(value)
}

function isDuration(value: string): value is RunsDuration {
  return (RUNS_DURATIONS as readonly string[]).includes(value)
}

function isCost(value: string): value is RunsCost {
  return (RUNS_COSTS as readonly string[]).includes(value)
}

/** Accepts Next.js `searchParams` (string | string[] | undefined values). */
export type RawSearchParams = Record<string, string | string[] | undefined>

function firstValue(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? ''
  return raw ?? ''
}

/**
 * Alias historique de `agent`. L'onglet « Historique » d'une fiche Agent
 * (`object-tabs.ts`) pointe vers `/runs?copilot=<id>` — le vocabulaire du data
 * layer (`AgentRun.copilotId`), pas celui de ce filtre. Les deux sont acceptés
 * ICI, dans l'unique parseur, plutôt que réconciliés dans la page : un second
 * endroit qui traduit `copilot` → `agent` serait une deuxième logique de
 * parsing, exactement ce qu'on refuse. `agent` gagne quand les deux sont
 * présents, et c'est la seule forme réécrite dans l'URL par
 * `serializeRunsFilters`.
 */
export const AGENT_PARAM_ALIASES = ['agent', 'copilot'] as const

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
  const duration = firstValue(params.duration)
  const cost = firstValue(params.cost)

  return {
    q: firstValue(params.q).slice(0, 200),
    agent: firstValue(params.agent) || firstValue(params.copilot),
    project: firstValue(params.project),
    status: isStatus(status) ? status : '',
    period: isPeriod(period) ? period : DEFAULT_RUNS_FILTERS.period,
    provider: firstValue(params.provider),
    model: firstValue(params.model),
    duration: isDuration(duration) ? duration : '',
    cost: isCost(cost) ? cost : '',
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
  if (state.provider) params.set('provider', state.provider)
  if (state.model) params.set('model', state.model)
  if (state.duration) params.set('duration', state.duration)
  if (state.cost) params.set('cost', state.cost)
  return params.toString()
}

/**
 * État de filtre → URL `/runs` complète, avec la sélection de run optionnelle.
 *
 * UNE seule construction d'URL pour cet écran. Le serveur l'utilise pour les
 * liens de ligne (`buildHref`) et le client pour la navigation de filtre : deux
 * appelants, une seule règle d'ordre et d'omission des défauts. Une deuxième
 * concaténation à la main dériverait au premier filtre ajouté.
 *
 * `run` est écrit EN DERNIER et n'est jamais recopié depuis l'état de filtre :
 * la sélection n'est pas un filtre, elle se compose avec lui.
 */
export function buildRunsHref(state: RunsFilterState, runId?: string | null): string {
  const qs = serializeRunsFilters(state)
  const params = new URLSearchParams(qs)
  if (runId) params.set('run', runId)
  const query = params.toString()
  return query ? `/runs?${query}` : '/runs'
}

export function hasActiveFilters(state: RunsFilterState): boolean {
  return (
    Boolean(state.q.trim()) ||
    Boolean(state.agent) ||
    Boolean(state.project) ||
    Boolean(state.status) ||
    state.period !== DEFAULT_RUNS_FILTERS.period ||
    Boolean(state.provider) ||
    Boolean(state.model) ||
    Boolean(state.duration) ||
    Boolean(state.cost)
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

/** `null`/non-finite excludes a run from EVERY bucket: unmeasured is not
 *  "under 1s", it is absent, and only shows up when no duration filter runs. */
function matchesDuration(run: AgentRun, duration: RunsDuration): boolean {
  if (typeof run.latencyMs !== 'number' || !Number.isFinite(run.latencyMs)) return false
  if (duration === 'lt1s') return run.latencyMs < 1000
  if (duration === '1to10s') return run.latencyMs >= 1000 && run.latencyMs < 10_000
  return run.latencyMs >= 10_000
}

function matchesCost(run: AgentRun, cost: RunsCost): boolean {
  return cost === 'measured' ? run.costUsd !== null : run.costUsd === null
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
    if (state.provider && (run.resolvedProvider ?? null) !== state.provider) return false
    if (state.model && (run.resolvedModel ?? null) !== state.model) return false
    if (state.duration && !matchesDuration(run, state.duration)) return false
    if (state.cost && !matchesCost(run, state.cost)) return false

    const startedMs = Date.parse(run.startedAt)
    // An unparseable timestamp is kept rather than dropped: hiding a row because
    // its date is malformed would under-report the fleet without saying so.
    if (Number.isFinite(startedMs) && startedMs < since) return false

    if (query && !matchesQuery(run, query, ctx)) return false
    return true
  })
}
