/**
 * Project Team Canvas — normalized read contract.
 *
 * ONE shape, produced by `data.ts` and consumed by the /team API + canvas UI.
 * Everything here is DERIVED FROM PERSISTED TRUTH. There is no fabrication
 * path: a value that cannot be read is `null` (or the node is marked
 * `unavailable`), never a plausible-looking zero.
 *
 * Non-negotiable exclusions: this contract carries NO prompt, NO manifest
 * body, NO token/secret/config. In particular `manifests.system_prompt_summary`
 * is never selected, never joined, never returned (see data.ts).
 */
import type { AgentRunStatus } from '../types'

/** Where the graph's facts came from. Only LIVE exists today (gpu1 PostgREST). */
export type ProjectTeamFreshnessSource = 'LIVE'

/**
 * Node status shown on the canvas.
 *
 * `active` ALWAYS means a real run is currently running — it is never inferred
 * from `copilots.status === 'active'`. See `status.ts` for the priority order.
 * `unavailable` means the underlying data could not be read; it is a distinct
 * state from `idle` (which is a real, observed absence of activity).
 */
export type ProjectTeamNodeStatus =
  | 'active'
  | 'waiting'
  | 'blocked'
  | 'failed'
  | 'idle'
  | 'draft'
  | 'unavailable'

export type ProjectTeamNodeKind = 'project' | 'group' | 'agent'

export type ProjectTeamEdgeRelation =
  | 'project-membership'
  | 'team-membership'
  | 'orchestrates'
  | 'depends-on'
  | 'sends-output-to'
  | 'reviews'
  | 'triggers'
  | 'shares-tool'

/**
 * `explicit` — a persisted row states this exact edge: a
 * `project_agent_relations` row, or an agent's `copilots.project_id` restated
 * as `project-membership`. Renders solid, reads "Configured".
 * `derived` — computed from deterministic, explainable evidence: tag-derived
 * team grouping, shared tool names, mission participation. Renders dashed,
 * reads "Derived". Never from names, models, or timing.
 *
 * Team grouping is `derived` even though `copilots.tags` is persisted: there is
 * no teams table, so the group node is a construct of `TEAM_TAG_RULES`
 * (relations.ts) and no operator ever configured it.
 */
export type ProjectTeamEdgeOrigin = 'explicit' | 'derived'

/**
 * Why a node's `latestRun` reads the way it does. A `null` latestRun is
 * AMBIGUOUS on its own — it arises from three different facts, and a renderer
 * that collapses them says "no run recorded" about data it simply could not
 * read. This field is what keeps them apart, end to end.
 *
 * `known`          — `latestRun` IS the truth. A run object is that run; `null`
 *                    means the agent genuinely has never run.
 * `unreadable`     — the run read failed. Nothing may be claimed about activity.
 * `outside-window` — the bounded run window truncated AND this agent had no run
 *                    inside it. It may have never run, or it may have been
 *                    pushed out by busier agents. Unknowable, not "never".
 * `not-applicable` — a container node (project / group). It has no run of its
 *                    own by construction, which is not the same statement as
 *                    "nothing ever ran here".
 */
export type ProjectTeamRunHistoryState =
  | 'known'
  | 'unreadable'
  | 'outside-window'
  | 'not-applicable'

/**
 * Whether the project-wide activity timestamp could be established at all.
 * `known` — `latestActivityAt` is the truth (`null` = the project never ran).
 * `unreadable` — the runs read failed, so there is no timestamp to report AND
 * no licence to say the project never ran.
 */
export type ProjectTeamActivityState = 'known' | 'unreadable'

/** Last run of an agent, or `null` when it has never run. */
export interface ProjectTeamLatestRun {
  id: string
  status: AgentRunStatus
  startedAt: string | null
  completedAt: string | null
  costUsd: number | null
  latencyMs: number | null
}

/**
 * Run metrics. EVERY field is nullable, and `null` means exactly one thing:
 * WE DO NOT KNOW. A `0` is always a measured zero — the runs were read and
 * there were none. The two must never render identically.
 *
 * `null` happens when the run read failed outright, or when the run window was
 * truncated (more runs exist than were fetched), which makes a per-agent count
 * a floor rather than a fact. A floor presented as a total is a wrong number.
 */
export interface ProjectTeamNodeMetrics {
  /** Exact total run count. `null` = unreadable or not exactly knowable. */
  totalRuns: number | null
  /** Exact run count on the current UTC day. `null` = unreadable/unknown. */
  runsToday: number | null
  /** completed / terminal runs, 0..1. `null` when no terminal run exists, or unknown. */
  successRate: number | null
}

export interface ProjectTeamNodeTool {
  id: string
  name: string
}

export interface ProjectTeamNode {
  id: string
  kind: ProjectTeamNodeKind
  name: string
  slug: string | null
  /**
   * Persisted role of the agent. `copilots` has NO role column today, so this
   * stays `null` for every agent rather than being invented from the name or
   * the model. It exists so a future persisted role slots in without a
   * contract change.
   */
  role: string | null
  description: string | null
  /** Team group label, derived from tags (see relations.ts). `null` = ungrouped. */
  team: string | null
  runtime: string | null
  model: string | null
  status: ProjectTeamNodeStatus
  latestRun: ProjectTeamLatestRun | null
  /** Disambiguates a `null` latestRun. See `ProjectTeamRunHistoryState`. */
  runHistory: ProjectTeamRunHistoryState
  metrics: ProjectTeamNodeMetrics
  tools: ProjectTeamNodeTool[]
  /**
   * The tool read failed for this graph. `tools` is then an EMPTY ARRAY that
   * asserts nothing: "no tool could be read" is not "no tool is declared", and
   * a renderer must say the former. Always `false` on container nodes, which
   * carry no tools by construction.
   */
  toolsUnavailable: boolean
  href: string | null
}

export interface ProjectTeamEdge {
  id: string
  source: string
  target: string
  relation: ProjectTeamEdgeRelation
  origin: ProjectTeamEdgeOrigin
  /**
   * Primary key of the `project_agent_relations` row this edge was built from.
   * NON-NULL ONLY for an edge that restates a persisted relation row — i.e. the
   * only edges an operator can delete. Every derived edge (membership, team,
   * shares-tool, orchestrates-from-mission) is null: there is no row behind it.
   */
  relationId: string | null
  label: string | null
  /**
   * A persisted event occurred ON THIS RELATION inside the recency window.
   *
   * NOT "both endpoints ran recently" — that is co-activity of two agents and
   * says nothing about them exchanging anything. This flag is what licenses the
   * canvas to animate flow along the edge, so it may only ever be set by
   * evidence of movement. Membership and `shares-tool` are static statements
   * and are therefore always `false`. See the V2 doctrine in relations.ts.
   */
  active: boolean
  /** Timestamp of that relation event, `null` when none is recorded. */
  lastActivityAt: string | null
  weight: number
}

/**
 * Project-wide roll-up.
 *
 * The four ACTIVITY counters are nullable for the same reason `runsToday` is:
 * they are derived from run-based statuses, and when a status cannot be derived
 * the count is not zero — it is unknown. Publishing `0` there let a failed runs
 * read render as the positive claim "0 Active · 0 Waiting · 0 Blocked · 0
 * Failed", which the aria-live region then read aloud as fact.
 *
 * They are known ONLY when every agent's status is known, i.e. when
 * `unavailableAgents === 0`. One unreadable agent makes "1 active" a floor, and
 * a floor rendered as a total is a wrong number.
 *
 * `totalAgents`, `draftAgents` and `unavailableAgents` stay non-nullable on
 * purpose: they are measured off the copilots read (which throws rather than
 * degrades) and off the observed status itself, so they are always facts.
 */
export interface ProjectTeamSummary {
  totalAgents: number
  /** `null` = at least one agent's status is unknown, so this is not countable. */
  activeAgents: number | null
  /** `null` = at least one agent's status is unknown, so this is not countable. */
  waitingAgents: number | null
  /** `null` = at least one agent's status is unknown, so this is not countable. */
  blockedAgents: number | null
  /** `null` = at least one agent's status is unknown, so this is not countable. */
  failedAgents: number | null
  draftAgents: number
  /**
   * Agents whose status could NOT be derived. Counted explicitly rather than
   * silently vanishing out of the four activity buckets — it is the number that
   * explains why they are `null`.
   */
  unavailableAgents: number
  /** Exact project-wide run count on the current UTC day. `null` = unreadable. */
  runsToday: number | null
}

export interface ProjectTeamFreshness {
  source: ProjectTeamFreshnessSource
  /**
   * Most recent run start across the project. `null` is AMBIGUOUS on its own —
   * read `latestActivityState` to know whether it means "the project never ran"
   * (`known`) or "the runs could not be read" (`unreadable`).
   */
  latestActivityAt: string | null
  /** Which of the two facts a `null` `latestActivityAt` states. */
  latestActivityState: ProjectTeamActivityState
}

export interface ProjectTeamGraph {
  project: { id: string; name: string }
  generatedAt: string
  freshness: ProjectTeamFreshness
  summary: ProjectTeamSummary
  nodes: ProjectTeamNode[]
  edges: ProjectTeamEdge[]
}
