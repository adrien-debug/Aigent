import 'server-only'

import { getAvailableAgent, getAvailableAgents, type AvailableAgent } from './available-agents'
import { getCopilot } from './data'
import type { PublishedAgent } from './runtime-api-types'

/**
 * Runtime catalogue — the ONE place a canonical agent becomes a published one.
 *
 * `/api/runtime/v1/**` consumers (TradeAgent and any other consumer repo) read
 * the catalogue through this mapper and nothing else. It deliberately does not
 * recompute anything: `getAvailableAgents()` is the same derivation the admin
 * catalogue, the counters and the run gate use, so "what Aigent shows",
 * "what may run" and "what a consumer sees" cannot disagree.
 *
 * Everything here is read-only. Nothing in this module writes.
 */

/**
 * Human-readable refusal reasons, mirroring the run route's 409 body.
 *
 * Kept in words a consumer can display: no internal tool ids, no stack, no
 * secret. `status` alone is never sufficient — an agent can be `active` and
 * still declare a tool that resolves to no registered handler.
 */
function nonExecutableReasons(agent: AvailableAgent): string[] {
  const reasons: string[] = []

  if (agent.status !== 'active') {
    reasons.push(
      agent.status === 'degraded'
        ? 'declares tools the runtime cannot execute'
        : agent.status === 'unavailable'
          ? 'retired, or a hard requirement is missing'
          : 'configured but not activated — activation requires a proven run'
    )
  }
  if (agent.unresolvedToolIds.length > 0) {
    const n = agent.unresolvedToolIds.length
    reasons.push(`${n} declared tool${n > 1 ? 's have' : ' has'} no registered handler`)
  }
  for (const field of agent.unavailableFields) {
    if (field === 'provider') reasons.push('no provider resolved')
    if (field === 'configuredModel') reasons.push('no model resolved')
    if (field === 'version') reasons.push('no serving version')
  }
  return reasons
}

/** Executable ⇔ the run gate would accept it. Same rule as the route. */
export function isExecutable(agent: AvailableAgent): boolean {
  return agent.status === 'active' && agent.unresolvedToolIds.length === 0
}

export async function toPublishedAgent(agent: AvailableAgent): Promise<PublishedAgent> {
  // `slug` and `updatedAt` live on the copilot row, not on the derived agent.
  const copilot = await getCopilot(agent.copilotId)
  const reasons = nonExecutableReasons(agent)

  return {
    id: agent.copilotId,
    slug: copilot?.slug ?? agent.copilotId,
    name: agent.name,
    description: agent.description,
    projectKey: agent.projectId,
    version: agent.version,
    status: agent.status,
    executable: isExecutable(agent),
    nonExecutableReasons: reasons,
    provider: agent.provider,
    configuredModel: agent.configuredModel,
    executedModel: agent.executedModel,
    runtime: copilot?.runtime ?? null,
    toolCount: agent.tools.length,
    unresolvedToolCount: agent.unresolvedToolIds.length,
    capabilities: agent.capabilities,
    readOnly: agent.readOnly,
    requiresHumanApproval: agent.requiresHumanApproval,
    lastRunAt: agent.lastRunAt,
    lastRunStatus: agent.lastRunStatus,
    lastRunCostUsd: agent.lastRunCostUsd,
    updatedAt: copilot?.updatedAt ?? null,
  }
}

/** The full published catalogue, ordered by name for a stable consumer view. */
export async function getPublishedAgents(): Promise<PublishedAgent[]> {
  const agents = await getAvailableAgents()
  const published = await Promise.all(agents.map(toPublishedAgent))
  return published.sort((a, b) => a.name.localeCompare(b.name))
}

/** One published agent, or `undefined` when no canonical row carries that id. */
export async function getPublishedAgent(agentId: string): Promise<PublishedAgent | undefined> {
  const agent = await getAvailableAgent(agentId)
  if (agent === undefined) return undefined
  return toPublishedAgent(agent)
}
