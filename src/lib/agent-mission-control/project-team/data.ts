/**
 * Project Team Canvas — server-side assembly of the team graph.
 *
 * LIVE ONLY, read-only. Reuses the existing data layer (getProject/getCopilots)
 * and the shared PostgREST client. Never writes.
 *
 * THREE guarantees this module is responsible for:
 *
 *  1. STRICT project isolation. Only copilots whose `project_id` EQUALS the
 *     requested project appear. `target_project_ids` (development intent, not
 *     membership) is ignored, and the 6 live copilots with a NULL project_id
 *     can never surface here.
 *  2. NO SECRETS. `manifests` is never queried — in particular
 *     `manifests.system_prompt_summary` is never selected, joined or returned.
 *     Only ids and tool NAMES leave this module.
 *  3. NO FABRICATION. A read that fails degrades to an explicit `unavailable`
 *     state or a `null` metric; it never becomes a zero. A `0` on this graph
 *     ALWAYS means "we read the runs and there were none" — an unknown is
 *     `null`, and the two are distinguishable all the way to the UI.
 *
 *     This extends to TRUNCATION: runs are read through a bounded window, so a
 *     count derived from it is a floor, not a total. The project total comes
 *     from PostgREST's exact `count=exact`; per-agent counts degrade to `null`
 *     when the window truncates rather than ship a floor labelled "Total".
 */
import 'server-only'

import { getProject } from '../data'
import { camelRows, pgrest, pgrestDetail, pgrestWithCount } from '../postgrest'
import type { AgentRun, Copilot } from '../types'
import {
  buildGroupedAgentMap,
  buildTeamEdges,
  buildTeamGroups,
  resolveTeamFromTags,
  type MissionParticipationInput,
  type ProjectAgentRelationRow,
  type TeamAgentInput,
  projectNodeId,
} from './relations'
import { deriveAgentStatus, toLatestRunSummary, type TeamRunInput } from './status'
import type {
  ProjectTeamEdge,
  ProjectTeamGraph,
  ProjectTeamNode,
  ProjectTeamNodeStatus,
  ProjectTeamNodeTool,
  ProjectTeamRunHistoryState,
} from './types'

type RawRow = Record<string, unknown>

/**
 * Shape of a project id (`makeId('proj', slug)`), same guard as the sibling
 * project routes.
 *
 * Exported and shared ON PURPOSE: the API route and the /team page are two
 * entry points into the SAME function, so they must trust exactly the same
 * thing. Two local copies of this regex is how one of them quietly stops
 * validating.
 */
const PROJECT_ID_RE = /^[a-z0-9-]{1,200}$/

export const isProjectId = (id: unknown): id is string =>
  typeof id === 'string' && PROJECT_ID_RE.test(id)

/**
 * Size of the run WINDOW loaded per project — the most recent N runs. Bounded
 * so this stays a couple of fast round trips on a project with heavy traffic
 * (the busiest live project has 73 runs). Status derivation only ever needs the
 * recent tail.
 *
 * It is a WINDOW, never a total: `rows.length` on a capped query is a FLOOR.
 * The exact total comes from PostgREST's `count=exact` (`Content-Range`), and
 * when the window truncates, per-agent counts degrade to `null` (unknown)
 * rather than shipping a floor labelled "Total".
 */
const RUNS_WINDOW = 500

/**
 * Max ids per `in.(...)` filter. PostgREST passes the list through as a URL
 * query, so an unbounded list on a large project would blow the server's URI
 * limit and 414. Chunking keeps it batched (NOT one query per agent) while
 * staying well inside the limit.
 */
const ID_CHUNK_SIZE = 100

/** Sum, or `null` if ANY term is unknown. Never treats `null` as 0. */
function sumKnown(values: readonly (number | null)[]): number | null {
  let total = 0
  for (const v of values) {
    if (v === null) return null
    total += v
  }
  return total
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const encodeIds = (ids: readonly string[]): string => ids.map((id) => encodeURIComponent(id)).join(',')

/** UTC day key (YYYY-MM-DD) — `runsToday` is defined on the current UTC day. */
function utcDayKey(iso?: string | null): string | null {
  if (typeof iso !== 'string' || iso.length === 0) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toISOString().slice(0, 10)
}

interface ToolRow {
  id: string
  name: string
  copilotId: string
}

/**
 * Tool ids + NAMES for a batch of copilots — one round trip per chunk, never
 * one per agent. Deliberately narrow `select`: no description, no scoped
 * routes, no config.
 */
async function loadToolsForCopilots(copilotIds: readonly string[]): Promise<ToolRow[]> {
  if (copilotIds.length === 0) return []
  const out: ToolRow[] = []
  for (const group of chunk(copilotIds, ID_CHUNK_SIZE)) {
    const rows = await pgrest<RawRow[]>(
      'GET',
      `tools?select=id,name,copilot_id&copilot_id=in.(${encodeIds(group)})&order=name`
    )
    out.push(...camelRows<ToolRow>(rows))
  }
  return out
}

/**
 * Explicit relations for the project. Narrow `select` on purpose, same
 * discipline as the tool read: `metadata` is an operator-writable free-form
 * jsonb blob that nothing on this graph consumes, and pulling it would drag
 * arbitrary written content into a payload path that is supposed to carry ids,
 * a relation type and a label. `created_at` is ordered on but not selected.
 */
const RELATION_COLUMNS = 'id,project_id,source_copilot_id,target_copilot_id,relation_type,label,is_active,updated_at'

async function loadRelations(projectId: string): Promise<ProjectAgentRelationRow[]> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `project_agent_relations?select=${RELATION_COLUMNS}&project_id=eq.${encodeURIComponent(projectId)}&order=created_at`
  )
  return camelRows<ProjectAgentRelationRow>(rows)
}

async function loadMissionParticipations(projectId: string): Promise<MissionParticipationInput[]> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `mission_runs?select=orchestrator_copilot_id,participant_copilot_ids,updated_at&project_id=eq.${encodeURIComponent(projectId)}`
  )
  return rows.map((row) => ({
    orchestratorCopilotId: typeof row.orchestrator_copilot_id === 'string' ? row.orchestrator_copilot_id : null,
    participantCopilotIds: Array.isArray(row.participant_copilot_ids)
      ? (row.participant_copilot_ids as unknown[]).filter((v): v is string => typeof v === 'string')
      : [],
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  }))
}

/**
 * Copilot columns this graph actually renders. Deliberately narrow: no
 * manifest, no assistant id, no health blob, no config. `project_id` is
 * selected even though it is already the filter, so the isolation invariant
 * can be RE-ASSERTED in memory rather than trusted.
 */
const COPILOT_COLUMNS = 'id,project_id,name,slug,description,runtime,model,status,tags'

/**
 * The project's agents — scoped at the DATABASE, not filtered in memory from a
 * full-table read.
 *
 * Deliberately NOT `getCopilots()`: that helper reads `copilots?select=*` (the
 * whole estate) and then runs `resolveCopilotHealthBatch` over every copilot in
 * the DB — five extra PostgREST round trips across test_runs/test_results/
 * benchmark_runs/benchmark_results. This graph never reads `copilot.health`,
 * and the refresh hook re-polls per open tab, so that work was scanning the
 * entire estate to draw one project, every time.
 *
 * `deriveDisplayStatus` (the other thing getCopilots() adds) is likewise not
 * used here: the canvas derives its own node status from RUNS in status.ts, and
 * reads the raw `copilots.status` column only to tell `draft` from the rest.
 * Nothing on the graph reads `displayStatus`, so there is nothing to re-apply.
 *
 * Indexed by `copilots_project_idx` on `copilots(project_id)`, and `eq.` on
 * project_id is the idiom used by every other project-scoped read.
 */
async function loadAgentsForProject(projectId: string): Promise<Copilot[]> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `copilots?select=${COPILOT_COLUMNS}&project_id=eq.${encodeURIComponent(projectId)}&order=name`
  )
  // STRICT isolation, re-asserted client-side: a row whose project_id is not
  // EXACTLY this project never becomes a member, whatever the filter returned.
  return camelRows<Copilot>(rows).filter((c) => c.projectId === projectId)
}

interface ProjectRunsRead {
  /** The most recent RUNS_WINDOW runs, newest first. */
  runs: AgentRun[]
  /** Exact project-wide run total, or `null` when PostgREST reported none. */
  totalExact: number | null
  /** True when runs exist beyond the window — every derived count is a floor. */
  truncated: boolean
}

/**
 * Runs for the project, plus the EXACT total. Not routed through
 * `getRecentRunsForProject` because that one joins `agent_run_steps` (unused
 * here) and defaults to 30 rows.
 *
 * `nullslast` matters: Postgres sorts NULLs FIRST on a DESC order, so without
 * it a pile of runs with a null `started_at` would occupy the head of the
 * window and push the actually-recent runs out of it.
 */
async function loadRunsForProject(projectId: string): Promise<ProjectRunsRead> {
  const { rows, count } = await pgrestWithCount<RawRow[]>(
    `agent_runs?select=id,copilot_id,status,started_at,finished_at,cost_usd,latency_ms&project_id=eq.${encodeURIComponent(projectId)}&order=started_at.desc.nullslast&limit=${RUNS_WINDOW}`
  )
  const runs = camelRows<AgentRun>(rows)
  // A capped query that returns FEWER rows than the cap has exhausted the
  // table: the window is then the whole set, and its length is exact.
  const exhausted = runs.length < RUNS_WINDOW
  return {
    runs,
    totalExact: count ?? (exhausted ? runs.length : null),
    truncated: count !== null ? count > runs.length : !exhausted,
  }
}

/**
 * Exact count of runs started on/after `sinceIso`, with no row transfer
 * (`limit=0` — PostgREST still computes `count=exact`). Only needed when the
 * window truncated; otherwise the in-memory count over the full set is exact
 * and this round trip is skipped entirely.
 */
async function countRunsSince(projectId: string, sinceIso: string): Promise<number | null> {
  const { count } = await pgrestWithCount<RawRow[]>(
    `agent_runs?select=id&project_id=eq.${encodeURIComponent(projectId)}&started_at=gte.${encodeURIComponent(sinceIso)}&limit=0`
  )
  return count
}

/**
 * A secondary read failed. The graph still renders, but the parts that depend
 * on it are marked `unavailable` — never silently zeroed.
 */
function logDegraded(what: string, err: unknown): void {
  // Server logs only: pgrestDetail() carries query/schema detail and must never
  // reach a response body (repo-wide rule).
  console.error(`[project-team] degraded: ${what} unreadable — ${pgrestDetail(err)}`)
}

export interface GetProjectTeamGraphOptions {
  /** Reference instant, injectable so `runsToday` and edge recency are testable. */
  now?: Date
}

/**
 * The project's team graph, or `undefined` when the project does not exist.
 *
 * `undefined` follows the `getProject()` convention so the route can 404
 * without catching an exception. A genuine upstream failure on the PROJECT or
 * COPILOTS read still throws (route maps it to 502/504); only the secondary
 * reads degrade to `unavailable`.
 */
export async function getProjectTeamGraph(
  projectId: string,
  options: GetProjectTeamGraphOptions = {}
): Promise<ProjectTeamGraph | undefined> {
  const now = options.now ?? new Date()
  const project = await getProject(projectId)
  if (!project) return undefined

  // Scoped at the DB. STRICT equality on projectId — targetProjectIds
  // (development intent) and NULL-project copilots are never members.
  const agents: Copilot[] = await loadAgentsForProject(projectId)
  const agentIds = agents.map((a) => a.id)

  let runs: AgentRun[] = []
  let runsUnavailable = false
  let runsTruncated = false
  let projectTotalRuns: number | null = null
  try {
    const read = await loadRunsForProject(projectId)
    runs = read.runs
    runsTruncated = read.truncated
    projectTotalRuns = read.totalExact
  } catch (err) {
    runsUnavailable = true
    logDegraded('agent_runs', err)
  }

  let toolRows: ToolRow[] = []
  let toolsUnavailable = false
  try {
    toolRows = await loadToolsForCopilots(agentIds)
  } catch (err) {
    // Tools only feed the derived `shares-tool` edges and the node tool chips.
    // Missing tools must NOT invent an empty toolset claim, but they also must
    // not blank the whole canvas: we drop the derived edges instead.
    //
    // `toolRows = []` alone did exactly the thing the comment forbids — an
    // empty array is indistinguishable from "this agent declares no tool", and
    // the panel rendered it as the assertion "No tool declared." The flag is
    // what makes the empty array claim nothing.
    logDegraded('tools', err)
    toolRows = []
    toolsUnavailable = true
  }

  let relations: ProjectAgentRelationRow[] = []
  try {
    relations = await loadRelations(projectId)
  } catch (err) {
    // Table may not exist yet (migration 0019 unapplied) — an empty relation
    // set is the honest reading: no explicit relation is recorded.
    logDegraded('project_agent_relations', err)
    relations = []
  }

  let missions: MissionParticipationInput[] = []
  try {
    missions = await loadMissionParticipations(projectId)
  } catch (err) {
    logDegraded('mission_runs', err)
    missions = []
  }

  // -- Index by agent -------------------------------------------------------
  const runsByAgent = new Map<string, TeamRunInput[]>()
  for (const run of runs) {
    if (!run.copilotId) continue
    const entry: TeamRunInput = {
      id: run.id,
      status: run.status,
      startedAt: run.startedAt ?? null,
      finishedAt: run.finishedAt ?? null,
      costUsd: typeof run.costUsd === 'number' ? run.costUsd : null,
      latencyMs: typeof run.latencyMs === 'number' ? run.latencyMs : null,
    }
    const bucket = runsByAgent.get(run.copilotId)
    if (bucket) bucket.push(entry)
    else runsByAgent.set(run.copilotId, [entry])
  }

  const toolsByAgent = new Map<string, ProjectTeamNodeTool[]>()
  const toolNamesByAgent = new Map<string, string[]>()
  for (const tool of toolRows) {
    if (!tool.copilotId) continue
    const list = toolsByAgent.get(tool.copilotId)
    if (list) list.push({ id: tool.id, name: tool.name })
    else toolsByAgent.set(tool.copilotId, [{ id: tool.id, name: tool.name }])
    const names = toolNamesByAgent.get(tool.copilotId)
    if (names) names.push(tool.name)
    else toolNamesByAgent.set(tool.copilotId, [tool.name])
  }

  const todayKey = now.toISOString().slice(0, 10)
  const lastActivityByAgentId = new Map<string, string | null>()

  // -- Agent nodes ----------------------------------------------------------
  const groupInputs: TeamAgentInput[] = agents.map((a) => ({ id: a.id, name: a.name, tags: a.tags ?? [] }))
  const groups = buildTeamGroups(groupInputs)
  const groupByAgentId = buildGroupedAgentMap(groups)

  const agentNodes: ProjectTeamNode[] = agents.map((copilot) => {
    const agentRuns = runsByAgent.get(copilot.id) ?? []

    // Truncation makes "zero runs in the window" ambiguous for THIS agent: it
    // may have never run, or it may simply have been pushed out of the window
    // by busier agents. Unknowable => unavailable, never a fabricated `idle`.
    // An agent that IS present in the window is safe: the window is globally
    // newest-first, so anything newer than its oldest visible run is in there
    // too — its recent history is complete, only its lifetime COUNT is a floor.
    //
    // The three cases stay SEPARATE all the way to the renderer: collapsing
    // them into one `null` latestRun is what let the UI say "no run recorded"
    // about runs it never managed to read.
    const runHistory: ProjectTeamRunHistoryState = runsUnavailable
      ? 'unreadable'
      : runsTruncated && agentRuns.length === 0
        ? 'outside-window'
        : 'known'
    const agentRunsUnavailable = runHistory !== 'known'
    // Counts are exact only over a complete run set.
    const countsKnown = !runsUnavailable && !runsTruncated

    const status = deriveAgentStatus({
      copilotStatus: copilot.status,
      runs: agentRuns,
      runsUnavailable: agentRunsUnavailable,
    })
    const terminal = agentRuns.filter(
      (r) => r.status === 'completed' || r.status === 'failed' || r.status === 'blocked'
    )
    const completed = terminal.filter((r) => r.status === 'completed').length
    const latestRun = agentRunsUnavailable
      ? null
      : toLatestRunSummary(
          agentRuns.reduce<TeamRunInput | null>((best, r) => {
            if (!best) return r
            const bv = Date.parse(best.startedAt ?? '')
            const rv = Date.parse(r.startedAt ?? '')
            if (Number.isNaN(rv)) return best
            if (Number.isNaN(bv)) return r
            return rv > bv ? r : best
          }, null)
        )

    lastActivityByAgentId.set(copilot.id, latestRun?.startedAt ?? null)

    const group = groupByAgentId.get(copilot.id)

    return {
      id: copilot.id,
      kind: 'agent',
      name: copilot.name,
      slug: copilot.slug ?? null,
      // No persisted role column exists — never invented from the name.
      role: null,
      description: copilot.description ?? null,
      // The node reports its TAG-derived team even when the group was too small
      // to get its own node; only the EDGE depends on the group existing.
      team: group?.team ?? resolveTeamFromTags(copilot.tags ?? []),
      runtime: copilot.runtime ?? null,
      model: copilot.model ?? null,
      status,
      latestRun,
      runHistory,
      metrics: {
        // `null`, not 0. 0 is reserved for "we read the runs and there were
        // none" — an unreadable or truncated set has no total to report.
        totalRuns: countsKnown ? agentRuns.length : null,
        runsToday: countsKnown
          ? agentRuns.filter((r) => utcDayKey(r.startedAt) === todayKey).length
          : null,
        // `null`, not 0: an agent with no terminal run has NO success rate, and
        // a rate over a truncated window is a sample, not the agent's rate.
        successRate: !countsKnown || terminal.length === 0 ? null : completed / terminal.length,
      },
      tools: toolsByAgent.get(copilot.id) ?? [],
      toolsUnavailable,
      href: `/admin/agents/${copilot.id}`,
    }
  })

  // -- Aggregates -----------------------------------------------------------
  // Project-wide `runsToday`. Over a COMPLETE run set the in-memory count is
  // already exact and costs nothing. Only when the window truncated do we spend
  // one extra round trip on an exact `count=exact` query (limit=0, no rows
  // transferred) rather than publish the window's floor as a fact.
  let runsToday: number | null
  if (runsUnavailable) {
    runsToday = null
  } else if (!runsTruncated) {
    runsToday = runs.filter((r) => utcDayKey(r.startedAt) === todayKey).length
  } else {
    try {
      runsToday = await countRunsSince(projectId, `${todayKey}T00:00:00.000Z`)
    } catch (err) {
      logDegraded('agent_runs (runsToday exact count)', err)
      runsToday = null
    }
  }

  // Safe under truncation: the window is newest-first, so the most recent run
  // of the whole project is inside it by construction.
  const latestActivityAt = runsUnavailable
    ? null
    : runs.reduce<string | null>((acc, r) => {
        const v = Date.parse(r.startedAt ?? '')
        if (Number.isNaN(v)) return acc
        if (acc === null) return r.startedAt
        return v > Date.parse(acc) ? r.startedAt : acc
      }, null)

  const countBy = (status: ProjectTeamNodeStatus): number =>
    agentNodes.filter((n) => n.status === status).length

  // How many agents have NO derivable status. Always a fact — an `unavailable`
  // status is directly observed, never inferred.
  const unavailableAgents = countBy('unavailable')

  /**
   * The four activity counters are countable ONLY when every agent's status is
   * known. With one `unavailable` agent in the set, "1 active" is a floor, and
   * a floor published as a total is a wrong number — the same rule the per-agent
   * metrics already follow under truncation.
   *
   * When the runs read fails outright, EVERY non-draft agent turns
   * `unavailable`, so all four counters used to compute to `0` and the UI
   * asserted "0 Active · 0 Waiting · 0 Blocked · 0 Failed" — with the aria-live
   * region speaking those fabricated zeros aloud — when the truth was simply
   * unknown.
   */
  const statusesKnown = unavailableAgents === 0
  const countActivity = (status: ProjectTeamNodeStatus): number | null =>
    statusesKnown ? countBy(status) : null

  /** Aggregate status of a container node (project or group) over its members. */
  const aggregateStatus = (members: readonly ProjectTeamNode[]): ProjectTeamNodeStatus => {
    if (members.length === 0) return runsUnavailable ? 'unavailable' : 'idle'
    if (members.some((n) => n.status === 'active')) return 'active'
    if (members.some((n) => n.status === 'waiting')) return 'waiting'
    if (members.some((n) => n.status === 'blocked')) return 'blocked'
    if (members.some((n) => n.status === 'failed')) return 'failed'
    if (members.every((n) => n.status === 'unavailable')) return 'unavailable'
    if (members.every((n) => n.status === 'draft')) return 'draft'
    return 'idle'
  }

  const nodeById = new Map(agentNodes.map((n) => [n.id, n]))

  const groupNodes: ProjectTeamNode[] = groups.map((group) => {
    const members = group.agentIds.map((id) => nodeById.get(id)).filter((n): n is ProjectTeamNode => Boolean(n))
    return {
      id: group.nodeId,
      kind: 'group',
      name: group.team,
      slug: null,
      role: null,
      description: null,
      team: group.team,
      runtime: null,
      model: null,
      status: aggregateStatus(members),
      latestRun: null,
      // A group has no run of its own — that is a structural fact, not the
      // claim "nothing here ever ran".
      runHistory: 'not-applicable',
      // A sum is only a fact when every term is known. One unknown member makes
      // the group total unknown — silently dropping it would understate the
      // group and read as a measured number.
      metrics: {
        totalRuns: sumKnown(members.map((n) => n.metrics.totalRuns)),
        runsToday: sumKnown(members.map((n) => n.metrics.runsToday)),
        successRate: null,
      },
      tools: [],
      // Containers carry no tools by construction, so there is nothing the
      // tool read could have failed to tell us about them.
      toolsUnavailable: false,
      href: null,
    }
  })

  const projectNode: ProjectTeamNode = {
    id: projectNodeId(projectId),
    kind: 'project',
    name: project.name,
    slug: project.slug ?? null,
    role: null,
    description: project.description ?? null,
    team: null,
    runtime: null,
    model: null,
    status: aggregateStatus(agentNodes),
    latestRun: null,
    // The project hub has no run of its own; project-wide activity is reported
    // by `freshness.latestActivityAt`, not by this node.
    runHistory: 'not-applicable',
    metrics: {
      // EXACT: from PostgREST's `count=exact`, not from the window length.
      totalRuns: runsUnavailable ? null : projectTotalRuns,
      runsToday,
      successRate: null,
    },
    tools: [],
    toolsUnavailable: false,
    href: `/admin/projects/${projectId}`,
  }

  const edges: ProjectTeamEdge[] = buildTeamEdges({
    projectId,
    agents: groupInputs,
    explicitRelations: relations,
    toolNamesByAgentId: toolNamesByAgent,
    missionParticipations: missions,
    lastActivityByAgentId,
    nowMs: now.getTime(),
  })

  return {
    project: { id: project.id, name: project.name },
    generatedAt: now.toISOString(),
    freshness: {
      source: 'LIVE',
      latestActivityAt,
      // A null `latestActivityAt` means "the project never ran" ONLY when the
      // runs were actually read. Unreadable runs say nothing either way.
      latestActivityState: runsUnavailable ? 'unreadable' : 'known',
    },
    summary: {
      totalAgents: agentNodes.length,
      activeAgents: countActivity('active'),
      waitingAgents: countActivity('waiting'),
      blockedAgents: countActivity('blocked'),
      failedAgents: countActivity('failed'),
      // Derived from `copilots.status`, which is read on a path that throws
      // rather than degrades — always a fact, so never nullable.
      draftAgents: countBy('draft'),
      unavailableAgents,
      runsToday,
    },
    nodes: [projectNode, ...groupNodes, ...agentNodes],
    edges,
  }
}
