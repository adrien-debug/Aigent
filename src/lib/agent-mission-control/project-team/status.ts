/**
 * Project Team Canvas — status derivation. PURE, no I/O, fully unit-tested.
 *
 * The single rule that matters: an agent is `active` ONLY when a real run is
 * currently running. `copilots.status === 'active'` is an AVAILABILITY flag
 * (the agent is materialized and enabled), not an activity signal — reading it
 * as "active" is the exact lie this module exists to prevent. Availability,
 * activity and the latest run are derived separately and exposed separately so
 * the UI can show them side by side instead of collapsing them into one badge.
 */
import type { AgentRunStatus, CopilotStatus } from '../types'
import type { ProjectTeamLatestRun, ProjectTeamNodeStatus } from './types'

/** Minimal run shape the derivation needs. Anything wider is ignored. */
export interface TeamRunInput {
  id: string
  status: AgentRunStatus | string
  startedAt: string | null
  finishedAt: string | null
  costUsd?: number | null
  latencyMs?: number | null
}

export interface DeriveAgentStatusInput {
  /** Raw `copilots.status`. An unrecognized value is treated as incoherent data. */
  copilotStatus?: CopilotStatus | string | null
  /** Runs belonging to THIS agent. An empty array is a real fact (never ran), not an error. */
  runs: readonly TeamRunInput[]
  /**
   * Explicit flag: the run list could not be read (upstream failure). This is
   * the ONLY way to reach `unavailable` from the run side — an empty `runs`
   * array means "never ran" and derives `idle`.
   */
  runsUnavailable?: boolean
}

/**
 * Availability = what the stored copilot row says about the agent existing and
 * being usable. Deliberately NOT a node status: it never implies activity.
 */
export type AgentAvailability = 'draft' | 'available' | 'suspended' | 'unknown'

const KNOWN_COPILOT_STATUSES: ReadonlySet<string> = new Set<CopilotStatus>([
  'active',
  'paused',
  'draft',
  'degraded',
  'archived',
])

/** Runs that have reached an end state. `needs-confirmation` and `running` have not. */
const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set<AgentRunStatus>([
  'completed',
  'failed',
  'blocked',
])

export function deriveAvailability(copilotStatus?: CopilotStatus | string | null): AgentAvailability {
  if (typeof copilotStatus !== 'string' || !KNOWN_COPILOT_STATUSES.has(copilotStatus)) return 'unknown'
  if (copilotStatus === 'draft') return 'draft'
  if (copilotStatus === 'paused' || copilotStatus === 'archived') return 'suspended'
  return 'available'
}

/** Epoch ms for ordering. Unparseable/missing sorts oldest, never crashes. */
function timeValue(iso?: string | null): number {
  if (typeof iso !== 'string' || iso.length === 0) return Number.NEGATIVE_INFINITY
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

/** Effective "when did this run land" — finish time when known, else start time. */
function runOrderValue(run: TeamRunInput): number {
  const finished = timeValue(run.finishedAt)
  return finished === Number.NEGATIVE_INFINITY ? timeValue(run.startedAt) : finished
}

function compareIdsDescending(a: TeamRunInput, b: TeamRunInput): number {
  if (a.id < b.id) return 1
  if (a.id > b.id) return -1
  return 0
}

/**
 * Newest-first comparator. Ties break on `id` descending so the output is
 * deterministic even when two runs share a timestamp to the millisecond.
 */
function byNewest(a: TeamRunInput, b: TeamRunInput): number {
  const delta = runOrderValue(b) - runOrderValue(a)
  if (delta !== 0 && Number.isFinite(delta)) return delta
  if (runOrderValue(b) !== runOrderValue(a)) return runOrderValue(b) > runOrderValue(a) ? 1 : -1
  return compareIdsDescending(a, b)
}

/** Latest run of any status, or `null`. */
export function pickLatestRun(runs: readonly TeamRunInput[]): TeamRunInput | null {
  if (runs.length === 0) return null
  return runs.toSorted(byNewest)[0] ?? null
}

/** Latest run that reached a terminal state, or `null`. */
export function pickLatestTerminalRun(runs: readonly TeamRunInput[]): TeamRunInput | null {
  const terminal = runs.filter((r) => TERMINAL_RUN_STATUSES.has(r.status))
  if (terminal.length === 0) return null
  return terminal.toSorted(byNewest)[0] ?? null
}

export interface AgentActivity {
  hasRunning: boolean
  hasNeedsConfirmation: boolean
  latestRun: TeamRunInput | null
  latestTerminalRun: TeamRunInput | null
  totalRuns: number
}

/** Activity = what the RUNS say. Never consults the copilot row. */
export function deriveActivity(runs: readonly TeamRunInput[]): AgentActivity {
  return {
    hasRunning: runs.some((r) => r.status === 'running'),
    hasNeedsConfirmation: runs.some((r) => r.status === 'needs-confirmation'),
    latestRun: pickLatestRun(runs),
    latestTerminalRun: pickLatestTerminalRun(runs),
    totalRuns: runs.length,
  }
}

/** Map a run onto the contract's `latestRun` shape. Missing numbers stay `null`. */
export function toLatestRunSummary(run: TeamRunInput | null): ProjectTeamLatestRun | null {
  if (!run) return null
  return {
    id: run.id,
    status: run.status as AgentRunStatus,
    startedAt: run.startedAt ?? null,
    completedAt: run.finishedAt ?? null,
    costUsd: typeof run.costUsd === 'number' && Number.isFinite(run.costUsd) ? run.costUsd : null,
    latencyMs: typeof run.latencyMs === 'number' && Number.isFinite(run.latencyMs) ? run.latencyMs : null,
  }
}

/**
 * Node status, in the mission's exact priority order:
 *
 *   1. draft       — copilots.status === 'draft' (not materialized)
 *   2. active      — a run with status 'running' exists
 *   3. waiting     — a run with status 'needs-confirmation' exists
 *   4. blocked     — the LATEST TERMINAL run is 'blocked'
 *   5. failed      — the LATEST TERMINAL run is 'failed'
 *   6. idle        — available, no current activity (includes "never ran")
 *   7. unavailable — required data unreadable/incoherent
 *
 * Rules 4 and 5 say "and no more recent successful run exists": taking THE
 * latest terminal run satisfies that by construction — a later `completed`
 * run would itself BE the latest terminal run and derive `idle`.
 *
 * `unavailable` is listed last but is EVALUATED right after `draft`, because
 * when the runs are unreadable none of rules 2-6 can be answered honestly.
 * Falling through to `idle` would fabricate "no activity" out of missing data,
 * which is exactly the invented zero this repo forbids.
 */
export function deriveAgentStatus(input: DeriveAgentStatusInput): ProjectTeamNodeStatus {
  const availability = deriveAvailability(input.copilotStatus)

  // 1 — draft wins over everything: a non-materialized agent has no runtime truth.
  if (availability === 'draft') return 'draft'

  // 7 (evaluated early, see doc above) — incoherent copilot row, or unreadable runs.
  if (availability === 'unknown') return 'unavailable'
  if (input.runsUnavailable === true) return 'unavailable'

  const activity = deriveActivity(input.runs)

  if (activity.hasRunning) return 'active' // 2 — a REAL running run, never copilots.status
  if (activity.hasNeedsConfirmation) return 'waiting' // 3

  const latestTerminal = activity.latestTerminalRun
  if (latestTerminal?.status === 'blocked') return 'blocked' // 4
  if (latestTerminal?.status === 'failed') return 'failed' // 5

  // 6 — available with no current activity. Zero runs lands here: an agent that
  // has never run is genuinely idle, not unavailable.
  return 'idle'
}

/** Convenience bundle: availability, activity and latest run, kept separate. */
export function deriveAgentState(input: DeriveAgentStatusInput): {
  status: ProjectTeamNodeStatus
  availability: AgentAvailability
  activity: AgentActivity
  latestRun: ProjectTeamLatestRun | null
} {
  const activity = deriveActivity(input.runs)
  return {
    status: deriveAgentStatus(input),
    availability: deriveAvailability(input.copilotStatus),
    activity,
    latestRun: input.runsUnavailable === true ? null : toLatestRunSummary(activity.latestRun),
  }
}
