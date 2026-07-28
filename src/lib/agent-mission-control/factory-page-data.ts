import { listAgentDrafts, type AgentDraftRow } from '@/lib/agent-mission-control/agent-drafts-store'
import { isPgrestTimeout, pgrestWithCount } from '@/lib/agent-mission-control/postgrest'
import { REGISTRY_HASH, RUNTIME_IDS, TOOL_IDS, getRuntime, getTool } from '@/lib/agent-mission-control/registry'
import { listActiveToolBuildMissions, type ToolBuildMissionRow } from '@/lib/agent-mission-control/tool-build-missions-store'
import type { FactoryRuntimeRow } from '@/components/agent-ops/factory/runtimes-panel'
import type { FactoryToolRow } from '@/components/agent-ops/factory/certified-tools-panel'

export interface FactoryPageData {
  runtimes: FactoryRuntimeRow[]
  certifiedTools: FactoryToolRow[]
  agentDraftCount: number | null
  agentDrafts: AgentDraftRow[] | null
  toolBuildMissions: ToolBuildMissionRow[] | null
  registryHash: string
}

async function getAgentDraftCount(): Promise<number | null> {
  try {
    const drafts = await pgrestWithCount('agent_drafts?select=id&limit=0')
    return drafts.count
  } catch (err) {
    // Fail-soft: a landing count must never take the page down. Null → dash.
    console.error('[admin/factory] draft count unavailable:', isPgrestTimeout(err) ? 'timeout' : err)
    return null
  }
}

/**
 * `/admin/factory` data-fetch, extracted so `page.tsx` stays a pure
 * `data + <View />` shell (see `scripts/check-views.mjs`).
 */
export async function getFactoryPageData(): Promise<FactoryPageData> {
  const runtimes: FactoryRuntimeRow[] = RUNTIME_IDS.map((id) => {
    const r = getRuntime(id)!
    return {
      id: r.id,
      label: r.label,
      engine: r.engine,
      executable: r.engine !== 'none',
      creatable: r.creatable && r.engine !== 'none',
      capabilities: r.capabilities,
      note: r.note,
    }
  })

  const allTools: FactoryToolRow[] = TOOL_IDS.map((id) => {
    const t = getTool(id)!
    return {
      id: t.id,
      version: t.version,
      label: t.label,
      summary: t.summary,
      kind: t.kind,
      mutates: t.mutates,
      risk: t.risk,
      requiresConfirmation: t.requiresConfirmation,
      provenance: t.provenance,
      certification: t.certification,
    }
  })
  const certifiedTools = allTools.filter((t) => t.certification === 'certified')

  const agentDraftCount = await getAgentDraftCount()
  let agentDrafts: AgentDraftRow[] | null = null
  let toolBuildMissions: ToolBuildMissionRow[] | null = null
  try {
    agentDrafts = await listAgentDrafts(12)
    toolBuildMissions = await listActiveToolBuildMissions(12)
  } catch (err) {
    console.error('[admin/factory] draft/mission lists unavailable:', isPgrestTimeout(err) ? 'timeout' : err)
  }

  return { runtimes, certifiedTools, agentDraftCount, agentDrafts, toolBuildMissions, registryHash: REGISTRY_HASH }
}
