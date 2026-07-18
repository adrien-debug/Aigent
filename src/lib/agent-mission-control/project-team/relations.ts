/**
 * Project Team Canvas — edge derivation. PURE, no I/O, fully unit-tested.
 *
 * ============================ THE TRUTH RULES ============================
 *
 * The schema has NO agent-to-agent relation today: no parent/supervisor/
 * orchestrator/upstream/downstream/reviewer/depends_on column, no junction
 * table, no teams table (verified across all migrations AND the live schema).
 * Every edge on this canvas therefore comes from exactly one of three places,
 * and NOTHING else:
 *
 *   Level 1 — EXPLICIT   rows of `project_agent_relations` (migration 0019).
 *   Level 2 — STRUCTURE  `project-membership` of an AGENT to the project node:
 *                        a verbatim restatement of the persisted
 *                        `copilots.project_id`. That — and only that — is
 *                        `explicit`.
 *   Level 3 — DERIVED    deterministic, explainable computation over persisted
 *                        rows: tag-derived team grouping, shared tool NAMES,
 *                        mission participation.
 *
 * ------------------------- PROVENANCE IS NOT COSMETIC -------------------------
 *
 * `origin` drives how an edge is RENDERED (solid vs dashed) and WORDED
 * ("Configured" vs "Derived") in the inspector panel. Stamping a computed edge
 * `explicit` therefore tells the operator "someone configured this", which is a
 * lie when no row backs it. The rule is mechanical:
 *
 *   `explicit` ⟺ a persisted row states this exact edge.
 *
 * Team groups are the trap. `copilots.tags` is real persisted data, so the
 * GROUPING is legitimate — but there is no teams table and no team_id column:
 * the group node itself is a construct of TEAM_TAG_RULES below, an editable
 * table living in this file. No operator ever configured it. Hence BOTH edges
 * that touch a group node are `derived`:
 *   - agent -> group   (`team-membership`)
 *   - group -> project (`project-membership`, source node is itself derived)
 * An agent that lands in no group attaches straight to the project, and THAT
 * edge is `explicit` — it is `copilots.project_id` and nothing else.
 *
 * EXPLICITLY FORBIDDEN, and deliberately not implemented anywhere below:
 *   - inferring an orchestrator from an agent's NAME ("supervisor", "lead", …)
 *   - building hierarchy from the model used (gpt-4 is not the boss of gpt-3)
 *   - creating a dependency merely because two agents share a project
 *   - inferring a workflow from temporal proximity of runs
 *
 * When there is no evidence, the correct output is NO EDGE. An empty canvas is
 * an honest canvas; a plausible-looking one built from names is a lie.
 */
import type { ProjectTeamEdge, ProjectTeamEdgeOrigin, ProjectTeamEdgeRelation } from './types'

// ---------------------------------------------------------------------------
// Tunable, inspectable constants
// ---------------------------------------------------------------------------

/**
 * A tool name held by MORE than this many agents in the project is a COMMODITY
 * and yields no `shares-tool` edge.
 *
 * Why this exists: `read_copilot_summary`, `read_tool_permissions`,
 * `read_project_summary` and `read_recent_runs` are each declared by 14
 * copilots. Emitting a pair edge for a 14-agent tool would produce
 * 14*13/2 = 91 edges for that ONE tool name — a hairball that says nothing,
 * because "we both can read a summary" is not a relationship. Below the
 * threshold the sharing is specific enough to carry signal.
 */
export const SHARED_TOOL_MAX_AGENTS = 4

/**
 * Window in which a RELATION EVENT counts as "recent" for `edge.active`.
 *
 * See `buildRelationEventIndex` for what may open this window. It is NOT the
 * window in which an endpoint agent ran: endpoint runs never make an edge
 * active (V2 doctrine below).
 */
export const RECENT_ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** A team group node is only created when it holds at least this many agents. */
export const MIN_GROUP_SIZE = 2

/**
 * TEAM GROUPING RULE — ordered allowlist, first match wins.
 *
 * `copilots.tags` mixes two very different things: PROVENANCE markers (how the
 * agent was created: 'drafted', 'agent-builder', 'repo-aware', 'bench', …) and
 * FUNCTIONAL markers (what the agent is for). Only the functional ones may form
 * a team; grouping by provenance would cluster agents by their birth story,
 * which is meaningless on a team canvas.
 *
 * The list is ORDERED, so an agent carrying several functional tags lands in a
 * single, deterministic group (first entry wins — no set-iteration luck). It is
 * exported so the rule is inspectable and testable rather than buried.
 */
export const TEAM_TAG_RULES: readonly { readonly tag: string; readonly team: string }[] = [
  { tag: 'authoring', team: 'Authoring' },
  { tag: 'review', team: 'Review' },
  { tag: 'security', team: 'Security' },
  { tag: 'ops', team: 'Ops' },
  { tag: 'data', team: 'Data' },
  { tag: 'research', team: 'Research' },
  { tag: 'trading', team: 'Trading' },
  { tag: 'finance', team: 'Finance' },
  { tag: 'marketing', team: 'Marketing' },
  { tag: 'support', team: 'Support' },
  { tag: 'meta', team: 'Meta' },
]

/**
 * Pure-provenance tags — they describe how an agent came to exist, never what
 * it does. Never a team, even if a rule above were added for them by mistake.
 */
export const PROVENANCE_TAGS: ReadonlySet<string> = new Set([
  'drafted',
  'agent-builder',
  'repo-aware',
  'bench',
  'internal',
  'controlled',
  'seed',
  'test',
  'draft',
])

/** Relation types accepted from `project_agent_relations.relation_type`. */
export const EXPLICIT_RELATION_TYPES: readonly ProjectTeamEdgeRelation[] = [
  'orchestrates',
  'depends-on',
  'sends-output-to',
  'reviews',
  'triggers',
]

/** Deterministic edge ordering — index in this list is the primary sort key. */
const RELATION_ORDER: readonly ProjectTeamEdgeRelation[] = [
  'project-membership',
  'team-membership',
  'orchestrates',
  'depends-on',
  'sends-output-to',
  'reviews',
  'triggers',
  'shares-tool',
]

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface TeamAgentInput {
  id: string
  name: string
  tags: readonly string[]
}

export interface ProjectAgentRelationRow {
  id: string
  projectId: string
  sourceCopilotId: string
  targetCopilotId: string
  relationType: string
  label?: string | null
  isActive?: boolean | null
  updatedAt?: string | null
}

/** One mission run, used ONLY for the `orchestrates` derivation. */
export interface MissionParticipationInput {
  orchestratorCopilotId: string | null
  participantCopilotIds: readonly string[]
  updatedAt?: string | null
}

export interface BuildTeamEdgesInput {
  projectId: string
  /** Agents ALREADY filtered to this project. */
  agents: readonly TeamAgentInput[]
  explicitRelations?: readonly ProjectAgentRelationRow[]
  /** agentId -> tool names it declares. */
  toolNamesByAgentId?: ReadonlyMap<string, readonly string[]>
  missionParticipations?: readonly MissionParticipationInput[]
  /**
   * agentId -> ISO timestamp of its most recent run (`null` = never ran).
   *
   * DELIBERATELY NOT CONSULTED when computing `edge.active` /
   * `edge.lastActivityAt` — see the V2 doctrine on `buildRelationEventIndex`.
   * An agent's own runs are a fact about the NODE, and `data.ts` already
   * surfaces them there (`node.latestRun`, `node.metrics`). Reading them here
   * would recreate exactly the co-activity fallacy this module now forbids.
   *
   * Kept on the input so callers need not change, and so the next reader finds
   * this note instead of "helpfully" wiring it back into edge activity.
   */
  lastActivityByAgentId?: ReadonlyMap<string, string | null>
  /** Reference instant for the recency window. Defaults to now. */
  nowMs?: number
}

export interface TeamGroup {
  team: string
  nodeId: string
  agentIds: string[]
}

// ---------------------------------------------------------------------------
// Node id helpers — stable, collision-free across kinds
// ---------------------------------------------------------------------------

export const projectNodeId = (projectId: string): string => `project:${projectId}`

const slugifyTeam = (team: string): string =>
  team
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const groupNodeId = (team: string): string => `group:${slugifyTeam(team)}`

// ---------------------------------------------------------------------------
// Team grouping
// ---------------------------------------------------------------------------

/**
 * Team label for an agent, or `null` when no functional tag matches.
 * A `null` team means the agent attaches directly to the project node.
 */
export function resolveTeamFromTags(tags: readonly string[] | null | undefined): string | null {
  if (!Array.isArray(tags) || tags.length === 0) return null
  const owned = new Set(tags.filter((t) => typeof t === 'string').map((t) => t.toLowerCase()))
  for (const rule of TEAM_TAG_RULES) {
    if (PROVENANCE_TAGS.has(rule.tag)) continue // belt and braces: provenance never groups
    if (owned.has(rule.tag)) return rule.team
  }
  return null
}

/**
 * Groups holding at least MIN_GROUP_SIZE agents, ordered by team label.
 * A lone agent in a would-be group gets no group node — a "team" of one is
 * visual noise, and it attaches straight to the project instead.
 */
export function buildTeamGroups(agents: readonly TeamAgentInput[]): TeamGroup[] {
  const byTeam = new Map<string, string[]>()
  for (const agent of agents) {
    const team = resolveTeamFromTags(agent.tags)
    if (team === null) continue
    const bucket = byTeam.get(team)
    if (bucket) bucket.push(agent.id)
    else byTeam.set(team, [agent.id])
  }
  return [...byTeam.entries()]
    .filter(([, ids]) => ids.length >= MIN_GROUP_SIZE)
    .map(([team, ids]) => ({ team, nodeId: groupNodeId(team), agentIds: [...ids].sort() }))
    .sort((a, b) => (a.team < b.team ? -1 : a.team > b.team ? 1 : 0))
}

/** agentId -> team label, but ONLY for agents inside a materialized group. */
export function buildGroupedAgentMap(groups: readonly TeamGroup[]): Map<string, TeamGroup> {
  const map = new Map<string, TeamGroup>()
  for (const group of groups) for (const id of group.agentIds) map.set(id, group)
  return map
}

// ---------------------------------------------------------------------------
// Activity helpers
// ---------------------------------------------------------------------------

/**
 * ===================== V2 DOCTRINE: WHAT MAKES AN EDGE ACTIVE ================
 *
 * DECISION (option "a"): `edge.active` is true ONLY when a persisted fact
 * records an event ON that relation. Everything else is `active: false` with
 * `lastActivityAt: null`.
 *
 * What this replaced, and why it was wrong: an edge used to be marked active
 * whenever BOTH endpoints happened to have run recently. That is CO-ACTIVITY of
 * two agents — "these two were both busy this week" — and nothing persisted
 * says they exchanged anything. The canvas then animated it as flow along the
 * edge (`animateFlow = viewMode === 'activity' && edge.active && directed`), so
 * two unrelated agents that merely ran the same afternoon rendered as a live
 * pipeline. Motion is the strongest claim this UI can make; it must be earned
 * by evidence of MOVEMENT, never by coincidence of timing.
 *
 * The ONLY fact in today's schema that records something happening *along* an
 * edge is a mission run tying `mission_runs.orchestrator_copilot_id` to its
 * participants: that run genuinely means the orchestrator drove the
 * participant. Keys are UNORDERED — the run evidences an interaction between
 * the pair, so it counts for a relation declared in either direction.
 *
 * NOTE: `orchestrator_copilot_id` is hardcoded NULL today
 * (mission-orchestrator.ts), so this index is empty in practice and every edge
 * is currently `active: false`. That is the CORRECT output, not a regression:
 * nothing persisted evidences traffic, so the canvas claims none. When
 * orchestrators start being recorded, real flow lights up with no change here.
 *
 * Membership and `shares-tool` can NEVER be active: "belongs to" and "declares
 * the same tool name" are static statements, not channels — nothing can flow
 * along them by definition.
 */
function buildRelationEventIndex(
  missions: readonly MissionParticipationInput[],
  agentIds: ReadonlySet<string>
): Map<string, string | null> {
  const index = new Map<string, string | null>()
  for (const mission of missions) {
    const orchestrator = mission.orchestratorCopilotId
    if (!orchestrator || !agentIds.has(orchestrator)) continue
    for (const participant of mission.participantCopilotIds ?? []) {
      if (participant === orchestrator || !agentIds.has(participant)) continue
      const key = unorderedPairKey(orchestrator, participant)
      index.set(key, laterOf(index.get(key) ?? null, mission.updatedAt ?? null))
    }
  }
  return index
}

function isRecent(iso: string | null | undefined, nowMs: number): boolean {
  if (typeof iso !== 'string' || iso.length === 0) return false
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return false
  return nowMs - ms <= RECENT_ACTIVITY_WINDOW_MS && ms <= nowMs
}

/** The more recent of two ISO timestamps, `null` when neither is usable. */
function laterOf(a: string | null | undefined, b: string | null | undefined): string | null {
  const av = typeof a === 'string' ? Date.parse(a) : Number.NaN
  const bv = typeof b === 'string' ? Date.parse(b) : Number.NaN
  const aOk = !Number.isNaN(av)
  const bOk = !Number.isNaN(bv)
  if (aOk && bOk) return av >= bv ? (a as string) : (b as string)
  if (aOk) return a as string
  if (bOk) return b as string
  return null
}

// ---------------------------------------------------------------------------
// Edge building
// ---------------------------------------------------------------------------

const edgeId = (relation: ProjectTeamEdgeRelation, source: string, target: string): string =>
  `${relation}::${source}::${target}`

function makeEdge(
  relation: ProjectTeamEdgeRelation,
  origin: ProjectTeamEdgeOrigin,
  source: string,
  target: string,
  extra: { label?: string | null; active?: boolean; lastActivityAt?: string | null; weight?: number } = {}
): ProjectTeamEdge {
  return {
    id: edgeId(relation, source, target),
    source,
    target,
    relation,
    origin,
    label: extra.label ?? null,
    active: extra.active ?? false,
    lastActivityAt: extra.lastActivityAt ?? null,
    weight: extra.weight ?? 1,
  }
}

/**
 * Build every edge of the project team graph.
 *
 * Output is deduplicated (explicit beats derived on the same triple) and
 * stable-sorted, so two calls on the same input are byte-identical.
 */
export function buildTeamEdges(input: BuildTeamEdgesInput): ProjectTeamEdge[] {
  const nowMs = input.nowMs ?? Date.now()
  const agents = input.agents
  const agentIds = new Set(agents.map((a) => a.id))
  const projectId = projectNodeId(input.projectId)

  const edges: ProjectTeamEdge[] = []

  // The only persisted evidence of movement along an edge. See the doctrine on
  // buildRelationEventIndex — endpoint runs are NOT consulted anywhere below.
  const relationEvents = buildRelationEventIndex(input.missionParticipations ?? [], agentIds)
  const relationEventAt = (a: string, b: string): string | null =>
    relationEvents.get(unorderedPairKey(a, b)) ?? null

  // -- Level 2: STRUCTURE ---------------------------------------------------
  // Membership carries NO activity: "belongs to" is a static statement, never a
  // channel. active:false / lastActivityAt:null on every membership edge.
  const groups = buildTeamGroups(agents)
  const groupByAgentId = buildGroupedAgentMap(groups)

  for (const group of groups) {
    // `derived`, not `explicit`: the group node exists only because
    // TEAM_TAG_RULES says so. No row anywhere states "this group belongs to
    // this project", so this edge must not render as configured either.
    edges.push(
      makeEdge('project-membership', 'derived', group.nodeId, projectId, {
        label: group.team,
        weight: group.agentIds.length,
      })
    )
  }

  for (const agent of agents) {
    const group = groupByAgentId.get(agent.id)
    if (group) {
      // Grouped agents attach to their group INSTEAD of the project — a single
      // membership path per agent, never both.
      //
      // `derived`: this edge restates a TAG, run through the TEAM_TAG_RULES
      // table in this file. The tag is persisted truth; the team it maps to is
      // our computation. An operator never configured this membership, so it
      // renders dashed and reads "Derived", like every other computed edge.
      edges.push(
        makeEdge('team-membership', 'derived', agent.id, group.nodeId, {
          label: group.team,
        })
      )
    } else {
      // The one genuinely explicit structural edge: a verbatim restatement of
      // the persisted `copilots.project_id`.
      edges.push(makeEdge('project-membership', 'explicit', agent.id, projectId))
    }
  }

  // -- Level 1: EXPLICIT relations -----------------------------------------
  // Cross-project relations are impossible by contract; enforced HERE at read
  // time (see migration 0019's comment) — any row whose endpoints are not both
  // agents of THIS project is dropped, not rendered.
  const explicitPairs = new Set<string>()
  for (const row of input.explicitRelations ?? []) {
    if (row.projectId !== input.projectId) continue
    if (!agentIds.has(row.sourceCopilotId) || !agentIds.has(row.targetCopilotId)) continue
    if (row.sourceCopilotId === row.targetCopilotId) continue
    const relation = EXPLICIT_RELATION_TYPES.find((r) => r === row.relationType)
    if (!relation) continue

    // Activity on an explicit relation needs BOTH: the operator must not have
    // disabled the row, AND a persisted event must have occurred on the pair.
    // `is_active` alone is a CONFIGURATION flag ("this relation is enabled"),
    // never proof that anything travelled — on its own it must not animate.
    const eventAt = relationEventAt(row.sourceCopilotId, row.targetCopilotId)
    edges.push(
      makeEdge(relation, 'explicit', row.sourceCopilotId, row.targetCopilotId, {
        label: row.label ?? null,
        active: row.isActive === false ? false : isRecent(eventAt, nowMs),
        lastActivityAt: eventAt,
      })
    )
    explicitPairs.add(unorderedPairKey(row.sourceCopilotId, row.targetCopilotId))
  }

  // -- Level 3a: DERIVED `orchestrates` from mission participation ----------
  // Only when mission_runs.orchestrator_copilot_id is genuinely non-null AND
  // both ends are agents of this project. In practice the column is always
  // NULL today (mission-orchestrator.ts hardcodes null), so this yields
  // NOTHING. That is CORRECT: no evidence, no edge.
  const seenOrchestration = new Set<string>()
  for (const mission of input.missionParticipations ?? []) {
    const orchestrator = mission.orchestratorCopilotId
    if (!orchestrator || !agentIds.has(orchestrator)) continue
    for (const participant of mission.participantCopilotIds ?? []) {
      if (participant === orchestrator || !agentIds.has(participant)) continue
      const key = `${orchestrator}::${participant}`
      if (seenOrchestration.has(key)) continue
      seenOrchestration.add(key)
      // The mission run IS the event on this relation: it records that the
      // orchestrator drove this participant. This is the one edge whose
      // activity rests on evidence of movement rather than coincidence.
      const eventAt = relationEventAt(orchestrator, participant)
      edges.push(
        makeEdge('orchestrates', 'derived', orchestrator, participant, {
          label: 'mission',
          active: isRecent(eventAt, nowMs),
          lastActivityAt: eventAt,
        })
      )
    }
  }

  // -- Level 3b: DERIVED `shares-tool` --------------------------------------
  // Two agents declaring a tool with the SAME `tools.name`. Commodity tools
  // (held by more than SHARED_TOOL_MAX_AGENTS agents) are skipped — see the
  // constant's doc for why 14-agent tools would produce an unreadable hairball.
  const toolNames = input.toolNamesByAgentId ?? new Map<string, readonly string[]>()
  const agentsByToolName = new Map<string, string[]>()
  for (const agent of agents) {
    const names = new Set((toolNames.get(agent.id) ?? []).filter((n) => typeof n === 'string' && n.length > 0))
    for (const name of names) {
      const bucket = agentsByToolName.get(name)
      if (bucket) bucket.push(agent.id)
      else agentsByToolName.set(name, [agent.id])
    }
  }

  const sharedByPair = new Map<string, { source: string; target: string; names: string[] }>()
  for (const [name, holders] of agentsByToolName) {
    if (holders.length < 2) continue
    if (holders.length > SHARED_TOOL_MAX_AGENTS) continue // commodity — no signal
    const sorted = [...holders].sort()
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const source = sorted[i] as string
        const target = sorted[j] as string
        // An explicit relation already describes this pair with real semantics;
        // a "they share a tool" edge on top of it is noise. Explicit wins.
        if (explicitPairs.has(unorderedPairKey(source, target))) continue
        const key = unorderedPairKey(source, target)
        const entry = sharedByPair.get(key)
        if (entry) entry.names.push(name)
        else sharedByPair.set(key, { source, target, names: [name] })
      }
    }
  }

  for (const { source, target, names } of sharedByPair.values()) {
    const sortedNames = [...names].sort()
    // Never active: "we declare the same tool name" is a static coincidence of
    // configuration. Nothing travels between these two agents because of it.
    edges.push(
      makeEdge('shares-tool', 'derived', source, target, {
        label: sortedNames.join(', '),
        weight: sortedNames.length,
      })
    )
  }

  // NOTE: `triggers` is intentionally NOT derived. It would require a persisted
  // reference (an agent declaring it triggers another); none exists in the
  // schema today, so the only `triggers` edges are explicit rows above.

  return sortEdges(dedupeEdges(edges, new Set([...agentIds, projectId, ...groups.map((g) => g.nodeId)])))
}

const unorderedPairKey = (a: string, b: string): string => (a < b ? `${a}::${b}` : `${b}::${a}`)

/**
 * Drop orphan edges (an endpoint that is not a real node — e.g. a relation row
 * pointing at a deleted agent) and collapse duplicates. On a duplicate triple
 * the `explicit` edge wins over the `derived` one.
 */
function dedupeEdges(edges: readonly ProjectTeamEdge[], knownNodeIds: ReadonlySet<string>): ProjectTeamEdge[] {
  const byKey = new Map<string, ProjectTeamEdge>()
  for (const edge of edges) {
    if (!knownNodeIds.has(edge.source) || !knownNodeIds.has(edge.target)) continue
    const existing = byKey.get(edge.id)
    if (!existing) {
      byKey.set(edge.id, edge)
      continue
    }
    if (existing.origin === 'derived' && edge.origin === 'explicit') byKey.set(edge.id, edge)
  }
  return [...byKey.values()]
}

/** Stable, total ordering: relation kind, then source, then target. */
function sortEdges(edges: ProjectTeamEdge[]): ProjectTeamEdge[] {
  const rank = (r: ProjectTeamEdgeRelation): number => {
    const i = RELATION_ORDER.indexOf(r)
    return i === -1 ? RELATION_ORDER.length : i
  }
  return edges.sort((a, b) => {
    const byRelation = rank(a.relation) - rank(b.relation)
    if (byRelation !== 0) return byRelation
    if (a.source !== b.source) return a.source < b.source ? -1 : 1
    if (a.target !== b.target) return a.target < b.target ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}
