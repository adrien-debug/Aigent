import { getAvailableAgents } from '@/lib/agent-mission-control/available-agents'
import { getCopilots, getProjects } from '@/lib/agent-mission-control/data'
import type { AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import type { Copilot } from '@/lib/agent-mission-control/types'

export interface AgentsListPageData {
  agents: AvailableAgent[]
  projectNameById: Map<string, string>
  healthByCopilotId: Map<string, Copilot>
  now: string
}

/**
 * `/admin/agents` data-fetch, extracted so `page.tsx` stays a pure
 * `data + <View />` shell (see `scripts/check-views.mjs`).
 */
export async function getAgentsListPageData(): Promise<AgentsListPageData> {
  const [agents, projects, copilots] = await Promise.all([
    getAvailableAgents(),
    getProjects(),
    // `list` depth: this page shows testPassRate + costLast24hUsd only, not
    // benchmark/latency — same batched call the dashboard project rollup uses,
    // loaded ONCE here and joined by id, never per-row.
    getCopilots({ health: 'list' }),
  ])

  return {
    agents,
    projectNameById: new Map(projects.map((p) => [p.id, p.name])),
    healthByCopilotId: new Map(copilots.map((c) => [c.id, c])),
    now: new Date().toISOString(),
  }
}
