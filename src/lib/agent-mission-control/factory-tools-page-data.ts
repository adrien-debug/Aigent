import { TOOL_IDS, getTool } from '@/lib/agent-mission-control/registry'
import type { FactoryToolRow } from '@/components/agent-ops/factory/certified-tools-panel'

/**
 * `/admin/factory/tools` data-fetch, extracted so `page.tsx` stays a pure
 * `data + <View />` shell (see `scripts/check-views.mjs`). Pure/sync (no IO) —
 * still lives here to match the `get*Overview`/`get*PageData` convention.
 */
export function getCertifiedFactoryTools(): FactoryToolRow[] {
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
