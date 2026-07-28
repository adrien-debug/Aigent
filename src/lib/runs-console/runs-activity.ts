import type { AgentRun } from '@/lib/agent-mission-control/types'

/**
 * AIGENT-FRONTEND-RESET-001 — the side surface of the runs cockpit: which
 * agents actually produced the runs currently in view.
 *
 * Derived from the SAME filtered array the table renders, so the panel can
 * never disagree with the rows next to it. Nothing is fetched or estimated
 * here — an agent appears only because it owns at least one real run.
 */

export interface AgentActivityRow {
  copilotId: string
  /** Display name when the copilot row was readable; else the raw id. */
  name: string
  /** `true` when the copilot row itself was NOT found — the id is shown as-is. */
  nameResolved: boolean
  runs: number
  completed: number
  failed: number
  blocked: number
  running: number
  /** Newest `startedAt` among this agent's runs, ISO. */
  lastStartedAt: string
  /** Sum of measured costs only; `null` when this agent had none measured. */
  measuredCostUsd: number | null
}

export function deriveAgentActivity(
  runs: AgentRun[],
  agentNameById: Map<string, string>,
  limit = 6
): AgentActivityRow[] {
  const byAgent = new Map<string, AgentActivityRow>()

  for (const run of runs) {
    let row = byAgent.get(run.copilotId)
    if (!row) {
      const name = agentNameById.get(run.copilotId)
      row = {
        copilotId: run.copilotId,
        name: name ?? run.copilotId,
        nameResolved: name !== undefined,
        runs: 0,
        completed: 0,
        failed: 0,
        blocked: 0,
        running: 0,
        lastStartedAt: run.startedAt,
        measuredCostUsd: null,
      }
      byAgent.set(run.copilotId, row)
    }

    row.runs += 1
    if (run.status === 'completed') row.completed += 1
    else if (run.status === 'failed') row.failed += 1
    else if (run.status === 'blocked') row.blocked += 1
    else if (run.status === 'running') row.running += 1

    if (Date.parse(run.startedAt) > Date.parse(row.lastStartedAt)) {
      row.lastStartedAt = run.startedAt
    }

    if (typeof run.costUsd === 'number' && Number.isFinite(run.costUsd)) {
      row.measuredCostUsd = (row.measuredCostUsd ?? 0) + run.costUsd
    }
  }

  return [...byAgent.values()]
    .toSorted(
      (a, b) =>
        b.runs - a.runs ||
        Date.parse(b.lastStartedAt) - Date.parse(a.lastStartedAt) ||
        a.name.localeCompare(b.name)
    )
    .slice(0, limit)
}
