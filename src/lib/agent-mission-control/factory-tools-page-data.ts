import { listActiveToolBuildMissions, type ToolBuildMissionRow } from '@/lib/agent-mission-control/tool-build-missions-store'
import { TOOL_IDS, getTool } from '@/lib/agent-mission-control/registry'
import type { FactoryToolRow } from '@/lib/agent-mission-control/page-view-models'
import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'

export interface FactoryToolsPageData {
  certifiedTools: FactoryToolRow[]
  activeMissions: ToolBuildMissionRow[] | null
}

/**
 * `/admin/factory/tools` data-fetch, extracted so `page.tsx` stays a pure
 * `data + <View />` shell (see `scripts/check-views.mjs`).
 */
export async function getFactoryToolsPageData(): Promise<FactoryToolsPageData> {
  const certifiedTools = getCertifiedFactoryTools()
  let activeMissions: ToolBuildMissionRow[] | null = null
  try {
    activeMissions = await listActiveToolBuildMissions(20)
  } catch (err) {
    console.error('[admin/factory/tools] mission list unavailable:', isPgrestTimeout(err) ? 'timeout' : err)
  }
  return { certifiedTools, activeMissions }
}

function getCertifiedFactoryTools(): FactoryToolRow[] {
  return TOOL_IDS.map((id) => {
    const tool = getTool(id)!
    return {
      id: tool.id,
      version: tool.version,
      label: tool.label,
      summary: tool.summary,
      kind: tool.kind,
      mutates: tool.mutates,
      risk: tool.risk,
      requiresConfirmation: tool.requiresConfirmation,
      provenance: tool.provenance,
      certification: tool.certification,
    }
  }).filter((tool) => tool.certification === 'certified')
}
