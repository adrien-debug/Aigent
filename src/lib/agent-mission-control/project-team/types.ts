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
 * `explicit` — persisted truth (a `project_agent_relations` row) or pure
 * structure (membership, which is a restatement of `copilots.project_id`).
 * `derived` — computed from deterministic, explainable evidence (shared tool
 * names, mission participation). Never from names, models, or timing.
 */
export type ProjectTeamEdgeOrigin = 'explicit' | 'derived'

/** Last run of an agent, or `null` when it has never run. */
export interface ProjectTeamLatestRun {
  id: string
  status: AgentRunStatus
  startedAt: string | null
  completedAt: string | null
  costUsd: number | null
  latencyMs: number | null
}

export interface ProjectTeamNodeMetrics {
  totalRuns: number
  runsToday: number
  /** completed / terminal runs, 0..1. `null` when no terminal run exists. */
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
  metrics: ProjectTeamNodeMetrics
  tools: ProjectTeamNodeTool[]
  href: string | null
}

export interface ProjectTeamEdge {
  id: string
  source: string
  target: string
  relation: ProjectTeamEdgeRelation
  origin: ProjectTeamEdgeOrigin
  label: string | null
  /** Real recent activity on both endpoints (or the relation's own flag) — never decoration. */
  active: boolean
  lastActivityAt: string | null
  weight: number
}

export interface ProjectTeamSummary {
  totalAgents: number
  activeAgents: number
  waitingAgents: number
  blockedAgents: number
  failedAgents: number
  draftAgents: number
  runsToday: number
}

export interface ProjectTeamFreshness {
  source: ProjectTeamFreshnessSource
  /** Most recent run start across the project, or `null` when the project never ran. */
  latestActivityAt: string | null
}

export interface ProjectTeamGraph {
  project: { id: string; name: string }
  generatedAt: string
  freshness: ProjectTeamFreshness
  summary: ProjectTeamSummary
  nodes: ProjectTeamNode[]
  edges: ProjectTeamEdge[]
}
