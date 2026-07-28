/**
 * Sync registry/tools.ts → tool_definitions + backfill tools.tool_definition_id.
 *
 * Usage:
 *   node --env-file=.env.local $(command -v npx) -y tsx --conditions=react-server scripts/sync-tool-definitions.ts
 */
import { backfillToolDefinitionIds, syncAllRegistryDefinitions } from '../src/lib/agent-mission-control/tool-catalog'

async function main() {
  const synced = await syncAllRegistryDefinitions()
  const backfilled = await backfillToolDefinitionIds()
  console.log(`✓ synced ${synced} tool definition(s), backfilled ${backfilled} mount FK(s)`)
}

main().catch((err) => {
  console.error('✗ sync-tool-definitions failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
