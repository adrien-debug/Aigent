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
 *     state; it never becomes a zero. `runsToday: 0` on this graph always means
 *     "we read the runs and there were none today".
 */
import 'server-only'

import { getCopilots, getProject } from '../data'
import { camelRows, pgrest, pgrestDetail } from '../postgrest'
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
} from './types'

type RawRow = Record<string, unknown>

/**
 * Runs pulled per project. Bounded so this stays a couple of fast round trips
 * on a project with heavy traffic (the busiest live project has 73 runs).
 * Status derivation only ever needs the recent tail.
 */
const RUNS_LIMIT = 500

/**
 * Max ids per `in.(...)` filter. PostgREST passes the list through as a URL
 * query, so an unbounded list on a large project would blow the server's URI
 * limit and 414. Chunking keeps it batched (NOT one query per agent) while
 * staying well inside the limit.
 */
const ID_CHUNK_SIZE = 100

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const encodeIds = (ids: readonly string[]): string => ids.map((id) => encodeURIComponent(id)).join(',')

/** UTC day key (YYYY-MM-DD) — `runsToday` is defined on the current UTC day. */
function utcDayKey(iso: string | null | undefined): string | null {
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

async function loadRelations(projectId: string): Promise<ProjectAgentRelationRow[]> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `project_agent_relations?select=*&project_id=eq.${encodeURIComponent(projectId)}&order=created_at`
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
 * Runs for the project. Not routed through `getRecentRunsForProject` because
 * that one joins `agent_run_steps` (unused here) and defaults to 30 rows.
 */
async function loadRunsForProject(projectId: string): Promise<AgentRun[]> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `agent_runs?select=id,copilot_id,status,started_at,finished_at,cost_usd,latency_ms&project_id=eq.${encodeURIComponent(projectId)}&order=started_at.desc&limit=${RUNS_LIMIT}`
  )
  return camelRows<AgentRun>(rows)
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

  // House convention: load all, filter in memory. STRICT equality on projectId —
  // targetProjectIds and NULL-project copilots are never members.
  const allCopilots = await getCopilots()
  const agents: Copilot[] = allCopilots.filter((c) => c.projectId === projectId)
  const agentIds = agents.map((a) => a.id)

  let runs: AgentRun[] = []
  let runsUnavailable = false
  try {
    runs = await loadRunsForProject(projectId)
  } catch (err) {
    runsUnavailable = true
    logDegraded('agent_runs', err)
  }

  let toolRows: ToolRow[] = []
  try {
    toolRows = await loadToolsForCopilots(agentIds)
  } catch (err) {
    // Tools only feed the derived `shares-tool` edges and the node tool chips.
    // Missing tools must NOT invent an empty toolset claim, but they also must
    // not blank the whole canvas: we drop the derived edges instead.
    logDegraded('tools', err)
    toolRows = []
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
    const status = deriveAgentStatus({
      copilotStatus: copilot.status,
      runs: agentRuns,
      runsUnavailable,
    })
    const terminal = agentRuns.filter(
      (r) => r.status === 'completed' || r.status === 'failed' || r.status === 'blocked'
    )
    const completed = terminal.filter((r) => r.status === 'completed').length
    const latestRun = runsUnavailable
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
      metrics: {
        totalRuns: runsUnavailable ? 0 : agentRuns.length,
        runsToday: runsUnavailable
          ? 0
          : agentRuns.filter((r) => utcDayKey(r.startedAt) === todayKey).length,
        // `null`, not 0: an agent with no terminal run has NO success rate.
        successRate: runsUnavailable || terminal.length === 0 ? null : completed / terminal.length,
      },
      tools: toolsByAgent.get(copilot.id) ?? [],
      href: `/admin/agents/${copilot.id}`,
    }
  })

  // -- Aggregates -----------------------------------------------------------
  const runsToday = runsUnavailable ? 0 : runs.filter((r) => utcDayKey(r.startedAt) === todayKey).length
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
      metrics: {
        totalRuns: members.reduce((s, n) => s + n.metrics.totalRuns, 0),
        runsToday: members.reduce((s, n) => s + n.metrics.runsToday, 0),
        successRate: null,
      },
      tools: [],
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
    metrics: {
      totalRuns: runsUnavailable ? 0 : runs.length,
      runsToday,
      successRate: null,
    },
    tools: [],
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
    freshness: { source: 'LIVE', latestActivityAt },
    summary: {
      totalAgents: agentNodes.length,
      activeAgents: countBy('active'),
      waitingAgents: countBy('waiting'),
      blockedAgents: countBy('blocked'),
      failedAgents: countBy('failed'),
      draftAgents: countBy('draft'),
      runsToday,
    },
    nodes: [projectNode, ...groupNodes, ...agentNodes],
    edges,
  }
}
