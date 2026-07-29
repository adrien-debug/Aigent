/**
 * /admin home — the page data adapter.
 *
 * THE ONLY PLACE THAT DOES ARITHMETIC for the home screen. Components render
 * what this returns and never re-derive a metric: a bucket total, a per-agent
 * sum, a percentage — all of it is computed once, here, from the SAME 24h
 * window the KPIs were computed on (`DashboardOverview.windowRuns`), so no two
 * blocks on the page can disagree about the same instant.
 *
 * Truth rules this module obeys:
 *
 * 1. NULL SURVIVES. Every KPI is passed through UNCHANGED. A `null` metric is
 *    "not measured" and must reach the component intact so it can render the
 *    words instead of a fabricated `0`. This module never coalesces a metric it
 *    is merely forwarding.
 *
 * 2. AGGREGATION IS NOT COALESCING. Summing a cost legitimately needs
 *    `(run.costUsd ?? 0)` INSIDE a reduce — that is how you add measured values.
 *    But an aggregate over nothing measurable is `null`, never `0`: see
 *    `sumMeasuredCost` below, and `computeCost24h` in `dashboard-overview.ts`
 *    which applies the same rule upstream. This file is deliberately outside
 *    `check-render-truth.mjs`'s scan (`src/app/admin/**`,
 *    `src/lib/runs-console/**`) for exactly that reason — the render surfaces
 *    are not.
 *
 * 3. BOUNDARIES COME FROM DATA. The chart buckets are cut from the first and
 *    last observed run timestamp, not from a hardcoded grid: an empty window
 *    yields zero buckets (an empty plate), never twelve decorative zeros.
 *
 * Server-side by construction — it reads `server-only` collectors. No
 * `'use client'`, and nothing here may be called from the browser.
 */
import 'server-only'

import { getAvailableAgents, type AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import {
  getDashboardOverview,
  type ActionItem,
  type DashboardKpis,
  type ProjectOverviewItem,
} from '@/lib/agent-mission-control/dashboard-overview'
import type { AgentRun, AgentRunStatus } from '@/lib/agent-mission-control/types'

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

/** One stacked bar of the activity chart. Both figures are measured counts. */
export type HomeChartBucket = {
  /** Bucket start, `HH:mm` in UTC — deterministic server-side formatting. */
  label: string
  /** Runs started inside this bucket. */
  total: number
  /** Of which `status === 'completed'`. The rest is the muted stack segment. */
  successful: number
}

/** One row of the dense agents table. */
export type HomeTopAgent = {
  copilotId: string
  /** Resolved from the agent catalogue; falls back to the copilot id, which is
   * a fact, never to a placeholder name. */
  name: string
  runs: number
  successful: number
  /** Sum over the runs whose cost WAS measured; `null` when none were. */
  costUsd: number | null
}

/** One row of the recent-activity list. */
export type HomeRecentRun = {
  id: string
  agentName: string
  /** Key into `AGENT_RUN_STATUS_LABELS` — never a display string. */
  status: AgentRunStatus
  startedAt: string
}

/**
 * One row of the dense recent-runs table (centre column).
 *
 * Carries the five columns the frame asks for — statut, durée, agent, projet,
 * heure — already resolved. `agentName`/`projectName` fall back to the raw id
 * when the catalogue does not know it: an id is a fact, a placeholder name
 * would not be.
 */
export type HomeRunRow = {
  id: string
  agentName: string
  projectName: string
  status: AgentRunStatus
  /** Measured execution time. */
  latencyMs: number
  startedAt: string
}

/** One progress row: a project and its pass rate as a WHOLE percentage. */
export type HomeProjectBar = {
  id: string
  name: string
  runsLast24h: number
  /** 0..100, already rounded. `null` when no copilot in the project has a
   * run-backed pass rate — the bar must then read "Not measured", not 0%. */
  passRatePercent: number | null
}

export type AdminHomeData = {
  /** Passed through from `getDashboardOverview()`, untouched. `null` stays `null`. */
  kpis: DashboardKpis
  /** Chronological, ≤ `BUCKET_COUNT` entries. Empty when the window has no runs. */
  hourlyBuckets: HomeChartBucket[]
  /** Largest `total` across the buckets — the chart's y scale. 0 when empty. */
  maxBucketTotal: number
  /** Window runs grouped by agent, busiest first, capped to 5. */
  topAgents: HomeTopAgent[]
  /** Newest first, capped to 6. */
  recentRuns: HomeRecentRun[]
  /** Newest first, capped to 8 — the centre column's dense runs table. */
  recentRunRows: HomeRunRow[]
  /** Passed through from the overview, in its own sort order. */
  projects: ProjectOverviewItem[]
  /** The first 3 of `projects`, with the pass rate pre-converted to a percent. */
  topProjects: HomeProjectBar[]
  /** Passed through, already priority-sorted by `buildActionItems`. */
  actionItems: ActionItem[]
  /** Runtime catalogue, capped to what the panel shows. Empty AND
   * `availableAgentTotal === null` ⇒ the read failed; empty with a total of 0 ⇒
   * a proven-empty catalogue. */
  availableAgents: AvailableAgent[]
  /** Full catalogue size before the cap. `null` = the read failed (ABSENT ≠ ZERO). */
  availableAgentTotal: number | null
  /** True when at least one collector degraded — the page must say so. */
  degraded: boolean
  /** The degradation reasons, de-duplicated. Empty ⇒ `degraded === false`. */
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Tuning — the only magic numbers, named
// ---------------------------------------------------------------------------

const BUCKET_COUNT = 12
const TOP_AGENT_LIMIT = 5
const RECENT_RUN_LIMIT = 6
const RUN_ROW_LIMIT = 8
const PROJECT_BAR_LIMIT = 3
const AVAILABLE_AGENT_LIMIT = 6

// ---------------------------------------------------------------------------
// Pure helpers — module-local (no consumer outside this file, and knip fails on
// an export nobody imports)
// ---------------------------------------------------------------------------

/** Milliseconds for a run's start, or `null` when the timestamp is unusable. */
function startedAtMs(run: Pick<AgentRun, 'startedAt'>): number | null {
  const ms = Date.parse(run.startedAt)
  return Number.isFinite(ms) ? ms : null
}

/** `HH:mm` in UTC. UTC, not local: the server must not render an hour that
 * depends on which machine rendered it. */
function bucketLabel(ms: number): string {
  const date = new Date(ms)
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/**
 * Cut the window's runs into `BUCKET_COUNT` equal slices between the FIRST and
 * LAST observed start time.
 *
 * The boundaries are observed, not assumed: no runs ⇒ no buckets, and a window
 * whose runs all land on one instant ⇒ one bucket. Both are honest pictures;
 * twelve zero-height bars would be a fabricated one.
 */
function buildBuckets(runs: AgentRun[]): HomeChartBucket[] {
  const timed = runs
    .map((run) => ({ run, ms: startedAtMs(run) }))
    .filter((entry): entry is { run: AgentRun; ms: number } => entry.ms !== null)

  if (timed.length === 0) return []

  const first = Math.min(...timed.map((entry) => entry.ms))
  const last = Math.max(...timed.map((entry) => entry.ms))
  const span = last - first

  if (span === 0) {
    return [
      {
        label: bucketLabel(first),
        total: timed.length,
        successful: timed.filter((entry) => entry.run.status === 'completed').length,
      },
    ]
  }

  const width = span / BUCKET_COUNT
  const buckets: HomeChartBucket[] = Array.from({ length: BUCKET_COUNT }, (_, index) => ({
    label: bucketLabel(first + index * width),
    total: 0,
    successful: 0,
  }))

  for (const entry of timed) {
    // The last run sits exactly on the upper bound; clamp it into the final
    // bucket instead of letting it fall off the end of the array.
    const index = Math.min(BUCKET_COUNT - 1, Math.floor((entry.ms - first) / width))
    const bucket = buckets[index]
    bucket.total += 1
    if (entry.run.status === 'completed') bucket.successful += 1
  }

  return buckets
}

/**
 * Sum the costs that WERE measured; `null` when none were.
 *
 * `?? 0` appears inside the reduce and only there: it is how an unmeasured
 * member is skipped from a sum of measured members. The RESULT is `null` when
 * the set of measured members is empty — an unmeasured cost never becomes $0.00.
 */
function sumMeasuredCost(runs: Pick<AgentRun, 'costUsd'>[]): number | null {
  const measured = runs.filter((run) => run.costUsd !== null && run.costUsd !== undefined)
  if (measured.length === 0) return null
  return measured.reduce((sum, run) => sum + (run.costUsd ?? 0), 0)
}

/** Newest first. Unparseable timestamps sink to the bottom rather than jumping
 * to the top on a `NaN` comparison. */
function byStartedAtDesc(a: AgentRun, b: AgentRun): number {
  return (startedAtMs(b) ?? Number.NEGATIVE_INFINITY) - (startedAtMs(a) ?? Number.NEGATIVE_INFINITY)
}

function buildTopAgents(runs: AgentRun[], nameById: Map<string, string>): HomeTopAgent[] {
  const grouped = new Map<string, AgentRun[]>()
  for (const run of runs) {
    const bucket = grouped.get(run.copilotId)
    if (bucket) bucket.push(run)
    else grouped.set(run.copilotId, [run])
  }

  return [...grouped.entries()]
    .map(([copilotId, agentRuns]) => ({
      copilotId,
      name: nameById.get(copilotId) ?? copilotId,
      runs: agentRuns.length,
      successful: agentRuns.filter((run) => run.status === 'completed').length,
      costUsd: sumMeasuredCost(agentRuns),
    }))
    .sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name))
    .slice(0, TOP_AGENT_LIMIT)
}

/** Pass rate 0..1 → whole percent, `null` preserved. */
function toPercent(ratio: number | null): number | null {
  return ratio === null ? null : Math.round(ratio * 100)
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

/**
 * Everything the /admin home page renders, in one server round.
 *
 * `getAvailableAgents()` is read alongside the overview (which consumes it for
 * its own executable KPIs but does not hand the list back) because the agents
 * panel needs the rows themselves. Its failure is caught: the page degrades to
 * an empty catalogue with `availableAgentTotal: null` and a warning, it does
 * not crash.
 */
export async function getAdminHomeData(nowMs: number = Date.now()): Promise<AdminHomeData> {
  const [overview, agentsResult] = await Promise.all([
    getDashboardOverview(nowMs),
    getAvailableAgents()
      .then((agents) => ({ agents, warning: null as string | null }))
      .catch(() => ({ agents: null, warning: 'Agent catalogue unavailable' })),
  ])

  const warnings = [...new Set([...overview.dataWarnings, ...(agentsResult.warning ? [agentsResult.warning] : [])])]
  const agents = agentsResult.agents
  const nameById = new Map((agents ?? []).map((agent) => [agent.copilotId, agent.name]))

  const projectNameById = new Map(overview.projects.map((project) => [project.id, project.name]))

  const hourlyBuckets = buildBuckets(overview.windowRuns)
  // Sorted once; the activity panel and the runs table are two views of the
  // same newest-first ordering, so they can never disagree about "recent".
  const newestFirst = [...overview.windowRuns].sort(byStartedAtDesc)

  const recentRuns = newestFirst.slice(0, RECENT_RUN_LIMIT).map((run) => ({
    id: run.id,
    agentName: nameById.get(run.copilotId) ?? run.copilotId,
    status: run.status,
    startedAt: run.startedAt,
  }))

  const recentRunRows = newestFirst.slice(0, RUN_ROW_LIMIT).map((run) => ({
    id: run.id,
    agentName: nameById.get(run.copilotId) ?? run.copilotId,
    projectName: projectNameById.get(run.projectId) ?? run.projectId,
    status: run.status,
    latencyMs: run.latencyMs,
    startedAt: run.startedAt,
  }))

  return {
    kpis: overview.kpis,
    hourlyBuckets,
    maxBucketTotal: hourlyBuckets.reduce((max, bucket) => Math.max(max, bucket.total), 0),
    topAgents: buildTopAgents(overview.windowRuns, nameById),
    recentRuns,
    recentRunRows,
    projects: overview.projects,
    topProjects: overview.projects.slice(0, PROJECT_BAR_LIMIT).map((project) => ({
      id: project.id,
      name: project.name,
      runsLast24h: project.runsLast24h,
      passRatePercent: toPercent(project.passRate),
    })),
    actionItems: overview.actionItems,
    availableAgents: (agents ?? []).slice(0, AVAILABLE_AGENT_LIMIT),
    availableAgentTotal: agents === null ? null : agents.length,
    degraded: warnings.length > 0,
    warnings,
  }
}
