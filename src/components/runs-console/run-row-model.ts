import type { AgentRun } from '@/lib/agent-mission-control/types'
import { formatDuration, formatUsd } from '@/lib/runs-console/runs-metrics'

/**
 * One presentation model for a run row, shared by the desktop table and the
 * mobile card list so both surfaces show the SAME fields, the same absences
 * and the same links. Every "—"/"Unverified" here is an absence the data
 * layer reported, never a value invented to fill a column.
 */
export interface RunRowModel {
  id: string
  shortId: string
  detailHref: string
  agentName: string
  agentHref: string
  agentNameResolved: boolean
  /** `null` ONLY when the run genuinely has no project. */
  projectName: string | null
  /** Set when the run HAS a project id, whether or not its name resolved. */
  projectId: string | null
  /**
   * `false` when the run has a project id whose name could not be read (a
   * degraded catalogue). That case must render the raw id, exactly like the
   * agent column does — collapsing it into the same "—"/"No project" used for
   * a genuinely project-less run turns a missing lookup into a stated fact.
   */
  projectNameResolved: boolean
  projectHref: string | null
  status: AgentRun['status']
  inputSummary: string | null
  /** `null` when the runner never proved a model for this run. */
  model: string | null
  provider: string | null
  modelVerified: boolean
  toolCallCount: number
  unsafeAttemptCount: number
  /** `null` when latency was not recorded — rendered as an em dash. */
  duration: string | null
  /** `null` when the run's cost was not measurable. */
  cost: string | null
  startedAtIso: string
  startedAtLabel: string
  traceUrl: string | null
}

/**
 * ALWAYS UTC, never the machine's zone.
 *
 * These rows are built inside a `'use client'` component that Next also renders
 * on the SERVER. Without an explicit `timeZone`, `toLocaleString` uses the
 * runtime's zone: the server formats in the container's (UTC in every Aigent
 * deployment) and the browser re-formats in the reader's, so the hydrated
 * markup differs from the server HTML — React discards it with a hydration
 * error, and an operator in Dubai briefly sees run times jump by four hours.
 *
 * Pinning UTC makes both sides byte-identical. It is also the right unit here:
 * run timestamps are read against server logs and LangSmith traces, which are
 * UTC. The column header says "Started (UTC)" so the zone is stated, not
 * assumed, and the raw instant stays available in `<time dateTime>`.
 */
function formatStartedAt(iso: string): string {
  const ms = Date.parse(iso)
  // An unparseable timestamp shows its raw value rather than a fabricated date.
  if (!Number.isFinite(ms)) return iso
  // 24h clock: the AM/PM suffix cost ~25px per row in a column that has to fit
  // inside the 2/3 feed panel, and operators read run times against logs.
  return new Date(ms).toLocaleString('en-GB', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function toRunRowModel(
  run: AgentRun,
  agentNameById: Map<string, string>,
  projectNameById: Map<string, string>
): RunRowModel {
  const agentName = agentNameById.get(run.copilotId)
  const projectName = run.projectId ? (projectNameById.get(run.projectId) ?? null) : null
  // "No project" and "project whose name we could not read" are different
  // facts and must render differently.
  const projectNameResolved = !run.projectId || projectName !== null

  // A model counts as verified only when the runner proved it: a value plus an
  // explicit `modelUnverified === false`. Absent flag ⇒ unverified (the DB
  // default), never silently trusted.
  const modelVerified = Boolean(run.resolvedModel) && run.modelUnverified === false

  return {
    id: run.id,
    shortId: run.id.slice(0, 8),
    detailHref: `/admin/agents/${run.copilotId}/runs?run=${encodeURIComponent(run.id)}`,
    agentName: agentName ?? run.copilotId,
    agentHref: `/admin/agents/${run.copilotId}`,
    agentNameResolved: agentName !== undefined,
    projectName,
    projectId: run.projectId ?? null,
    projectNameResolved,
    // The link is valid as soon as there IS a project id — an unreadable name
    // does not make the project page unreachable.
    projectHref: run.projectId ? `/admin/projects/${run.projectId}` : null,
    status: run.status,
    inputSummary: run.inputSummary?.trim() ? run.inputSummary.trim() : null,
    model: run.resolvedModel ?? null,
    provider: run.resolvedProvider ?? null,
    modelVerified,
    toolCallCount: run.toolCallCount,
    unsafeAttemptCount: run.unsafeAttemptCount,
    duration: formatDuration(run.latencyMs),
    cost: typeof run.costUsd === 'number' && Number.isFinite(run.costUsd) ? formatUsd(run.costUsd) : null,
    startedAtIso: run.startedAt,
    startedAtLabel: formatStartedAt(run.startedAt),
    traceUrl: run.traceUrl,
  }
}
