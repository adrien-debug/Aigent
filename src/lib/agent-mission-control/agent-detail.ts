import 'server-only'

import { getAvailableAgent, type AvailableAgent } from './available-agents'
import {
  getCopilot,
  getManifestForCopilot,
  getRunsForCopilot,
  getToolsForCopilot,
  getVersionsForCopilot,
} from './data'
import { getLatestDeliveryEvent, type DeliveryEvent } from './delivery-events-store'
import { isExecutable } from './runtime-catalogue'
import type { AgentManifest, AgentRun, Copilot, CopilotVersion, ToolDefinition } from './types'

/**
 * ONE resolver for every agent-detail section (AIGENT-AGENT-PAGES-021).
 *
 * The legacy pages each ran their own queries and each derived their own idea of
 * "is this agent OK". That is how the header could show a green status while the
 * run button 409'd: two answers, no single truth. Every section now reads this.
 *
 * `agent` is the canonical `AvailableAgent` — the same derivation the catalogue,
 * the counters and the run gate use. Executability is NOT recomputed here.
 */

/** Why a run cannot start. Empty ⇒ the agent is launchable right now. */
export type Blocker = { code: string; label: string; detail: string }

export type AgentDetail = {
  copilot: Copilot
  /** Canonical availability. `undefined` when the copilot is absent from the catalogue. */
  agent: AvailableAgent | undefined
  manifest: AgentManifest | undefined
  versions: CopilotVersion[]
  currentVersion: CopilotVersion | undefined
  tools: ToolDefinition[]
  runs: AgentRun[]
  /** Concrete reasons the run gate would refuse. Mirrors the route's 409 body. */
  blockers: Blocker[]
  /** True only when the run route would accept a launch right now. */
  executable: boolean
  metrics: AgentMetrics
  /**
   * The most recent `agent_delivery_events` row for this copilot, or `null`
   * when this agent has never been delivered. A read FAILURE here rejects the
   * `Promise.all` below like every other field in this resolver — the page's
   * own `error.tsx` catches it, so there is no silent "no delivery" reading
   * for a dead table. `null` here means "queried, none found", never "could
   * not read" — a failed read never reaches this type at all.
   */
  delivery: DeliveryEvent | null
}

/**
 * Windowed metrics. Every field is `number | null`: null means NOT MEASURED and
 * must render as a dash, never as 0. `runs24h = 0` is a real, measured zero —
 * the window was read and held nothing. The two must never collapse.
 */
export type AgentMetrics = {
  runs24h: number
  totalRuns: number
  successRate: number | null
  avgDurationMs: number | null
  cost24hUsd: number | null
  /** Runs in the window whose cost was never recorded — makes cost24h honest. */
  runsWithoutCost: number
  /**
   * Total tool calls summed over runs that actually COMPLETED. `null` (UNKNOWN)
   * only when no completed run exists to measure from — never a fabricated 0.
   * A real `0` here is MEASURED: the agent ran to completion and mounted no
   * tool (the "healthy catalogue / toolless execution" trap). `toolCallCountState`
   * lets the UI render "0 outils appelés" (MEASURED) vs "non mesuré" (UNKNOWN)
   * without re-deriving the rule.
   */
  toolCallCount: number | null
  toolCallCountState: 'MEASURED' | 'UNKNOWN'
  /** Completed runs the tool-call measurement is drawn from (its denominator). */
  completedRuns: number
  lastRun: AgentRun | undefined
}

const DAY_MS = 24 * 60 * 60 * 1000

function computeMetrics(runs: AgentRun[]): AgentMetrics {
  const now = Date.now()
  const recent = runs.filter((r) => {
    const t = Date.parse(r.startedAt ?? '')
    return Number.isFinite(t) && now - t <= DAY_MS
  })

  // Success rate only means something over runs that actually reached a verdict.
  const decided = runs.filter((r) => r.status === 'completed' || r.status === 'failed')
  const successRate =
    decided.length > 0 ? decided.filter((r) => r.status === 'completed').length / decided.length : null

  const durations = runs
    .map((r) => r.latencyMs)
    .filter((d): d is number => typeof d === 'number' && Number.isFinite(d))
  const avgDurationMs =
    durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null

  const costed = recent.filter((r) => typeof r.costUsd === 'number' && Number.isFinite(r.costUsd))
  const cost24hUsd = costed.length > 0 ? costed.reduce((a, r) => a + (r.costUsd ?? 0), 0) : null

  // Tool-call count is only a MEASUREMENT over runs that actually reached
  // completion: an aborted/running/blocked run's `tool_call_count` reflects how
  // far it got, not what the agent needs. With zero completed runs there is
  // nothing to measure ⇒ null (UNKNOWN), never a fabricated 0. With ≥1 completed
  // run the sum is MEASURED — and a genuine 0 (agent completed, mounted no tool:
  // the "healthy catalogue / toolless execution" trap) is preserved as 0, not
  // collapsed into "no data".
  const completed = runs.filter((r) => r.status === 'completed')
  const toolCallCount =
    completed.length > 0 ? completed.reduce((a, r) => a + (r.toolCallCount ?? 0), 0) : null
  const toolCallCountState: AgentMetrics['toolCallCountState'] =
    toolCallCount === null ? 'UNKNOWN' : 'MEASURED'

  return {
    runs24h: recent.length,
    totalRuns: runs.length,
    successRate,
    avgDurationMs,
    cost24hUsd,
    runsWithoutCost: recent.length - costed.length,
    toolCallCount,
    toolCallCountState,
    completedRuns: completed.length,
    lastRun: runs[0],
  }
}

/**
 * Blockers mirror the run route's own refusal logic, so the page can never
 * promise a launch the API would reject. Order is worst-first.
 */
function computeBlockers(agent: AvailableAgent | undefined, toolsById: Map<string, ToolDefinition>): Blocker[] {
  if (agent === undefined) {
    return [
      {
        code: 'not-in-catalogue',
        label: 'Not in the runtime catalogue',
        detail: 'No canonical agent row resolves for this copilot, so a run cannot be started.',
      },
    ]
  }

  const blockers: Blocker[] = []

  if (agent.status !== 'active') {
    const detail =
      agent.status === 'degraded'
        ? 'The agent declares tools the runner cannot execute.'
        : agent.status === 'unavailable'
          ? 'A hard requirement is missing, or the agent has been retired.'
          : 'The agent is configured but has not been activated. Activation requires a proven run.'
    blockers.push({
      code: 'status',
      label: `Status is ${agent.status}, not active`,
      detail,
    })
  }

  if (agent.unresolvedToolIds.length > 0) {
    const names = agent.unresolvedToolIds.map((id) => toolsById.get(id)?.name ?? id)
    blockers.push({
      code: 'unresolved-tools',
      label: `${agent.unresolvedToolIds.length} declared tool${agent.unresolvedToolIds.length > 1 ? 's' : ''} cannot run`,
      detail: `No registered handler for: ${names.join(', ')}.`,
    })
  }

  for (const field of agent.unavailableFields) {
    if (field === 'provider' || field === 'configuredModel' || field === 'version') {
      blockers.push({
        code: `missing-${field}`,
        label: `Missing ${field === 'configuredModel' ? 'model' : field}`,
        detail: 'The runtime cannot resolve this from persisted data, so a run cannot be started.',
      })
    }
  }

  // Mirrors `runtime-catalogue.isExecutable` — langgraph is the only executable
  // product runtime (AGENTS.md). This must be the SAME rule /admin/agents uses,
  // never a second one: a non-langgraph agent (runtime unset, 'direct', or any
  // other value) is never executable, but that is a distinct fact from the
  // LangGraph-specific reasons above (missing assistant, unresolved tools in the
  // graph registry) and must not be conflated with — or silently replaced by —
  // them. Only push this blocker when nothing else already explains why the
  // agent isn't executable per `isExecutable`, so a langgraph agent that is
  // otherwise healthy never gets a spurious runtime blocker, and a non-langgraph
  // agent gets exactly one clear reason instead of borrowed LangGraph wording.
  if (agent.runtime !== 'langgraph' && blockers.length === 0 && !isExecutable(agent)) {
    blockers.push({
      code: 'runtime-not-langgraph',
      label: `Runtime is ${agent.runtime ?? 'unset'}, not langgraph`,
      detail: 'LangGraph is the only executable product runtime; this agent has no wired execution path.',
    })
  }

  return blockers
}

export async function getAgentDetail(copilotId: string): Promise<AgentDetail | undefined> {
  const copilot = await getCopilot(copilotId)
  if (!copilot) return undefined

  const [agent, manifest, versions, tools, runs, delivery] = await Promise.all([
    getAvailableAgent(copilotId),
    getManifestForCopilot(copilotId),
    getVersionsForCopilot(copilotId),
    getToolsForCopilot(copilotId),
    getRunsForCopilot(copilotId, 50),
    getLatestDeliveryEvent(copilotId),
  ])

  const toolsById = new Map(tools.map((t) => [t.id, t]))
  const blockers = computeBlockers(agent, toolsById)

  const currentVersion =
    versions.find((v) => v.id === copilot.productionVersionId) ??
    versions.find((v) => v.id === copilot.latestVersionId) ??
    versions[0]

  return {
    copilot,
    agent,
    manifest,
    versions,
    currentVersion,
    tools,
    runs,
    blockers,
    executable: blockers.length === 0,
    metrics: computeMetrics(runs),
    delivery,
  }
}
