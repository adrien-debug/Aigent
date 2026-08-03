import 'server-only'

import { getAvailableAgent, getAvailableAgents, type AvailableAgent } from './available-agents'
import { getCopilot } from './data'
import { tenantCanSeeProject, toRuntimeRunStatus, type PublishedAgent, type RuntimeTenant } from './runtime-api-types'
import type { AgentRunStatus } from './types'

/** Internal run statuses the runner ever writes — the exhaustive input set. */
const INTERNAL_RUN_STATUSES = new Set<string>(['completed', 'failed', 'blocked', 'needs-confirmation', 'running'])

/**
 * Map a copilot's last INTERNAL run status onto the published RuntimeRunStatus,
 * so `PublishedAgent.lastRunStatus` never leaks `blocked`/`needs-confirmation`
 * to a consumer (the same contract the run responses honour). Unknown/absent → null.
 */
function publishedLastRunStatus(internal: string | null): string | null {
  if (internal === null || !INTERNAL_RUN_STATUSES.has(internal)) return null
  return toRuntimeRunStatus(internal as AgentRunStatus)
}

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
  if (agent.runtime !== 'langgraph') {
    reasons.push(`runtime is ${agent.runtime ?? 'unset'}, not langgraph (the only executable product runtime)`)
  }
  return reasons
}

/** Executable ⇔ the run gate would accept it. Same rule as the route: active,
 *  every tool resolved, AND runtime is langgraph (the only executable product
 *  runtime — the direct model-router engine stays internal to test/benchmark). */
export function isExecutable(agent: AvailableAgent): boolean {
  return agent.status === 'active' && agent.unresolvedToolIds.length === 0 && agent.runtime === 'langgraph'
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
    // Published contract vocabulary, never the internal AgentRunStatus.
    lastRunStatus: publishedLastRunStatus(agent.lastRunStatus),
    lastRunCostUsd: agent.lastRunCostUsd,
    updatedAt: copilot?.updatedAt ?? null,
  }
}

/**
 * The full published catalogue, ordered by name for a stable consumer view.
 *
 * `tenant` is REQUIRED — this is the one place `/api/runtime/v1/**` narrows the
 * fleet-wide derivation to what one caller may see. A `legacy-unscoped` tenant
 * (the pre-existing global `AIGENT_RUNTIME_API_TOKEN`) sees everything, exactly
 * as before this mission. An `installation` tenant sees only agents whose
 * `projectKey` matches its resolved project — every other agent is filtered
 * out here, not in the route, so no route can forget the filter.
 */
export async function getPublishedAgents(tenant: RuntimeTenant): Promise<PublishedAgent[]> {
  const agents = await getAvailableAgents()
  const scoped = agents.filter((a) => tenantCanSeeProject(tenant, a.projectId))
  const published = await Promise.all(scoped.map(toPublishedAgent))
  return published.toSorted((a, b) => a.name.localeCompare(b.name))
}

/**
 * One published agent, scoped to `tenant`.
 *
 * Returns `undefined` both when no canonical row carries that id AND when the
 * row exists but belongs to a different tenant — the two cases MUST be
 * indistinguishable to the caller (see `resolveRuntimeTenant`'s doc: an agent
 * belonging to another tenant reads as "not found", never as "forbidden",
 * because revealing existence is itself information the other tenant did not
 * consent to leak).
 */
export async function getPublishedAgent(agentId: string, tenant: RuntimeTenant): Promise<PublishedAgent | undefined> {
  const agent = await getAvailableAgent(agentId)
  if (agent === undefined) return undefined
  if (!tenantCanSeeProject(tenant, agent.projectId)) return undefined
  return toPublishedAgent(agent)
}
