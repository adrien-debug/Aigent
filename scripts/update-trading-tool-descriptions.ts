/** AIG-TRADE-001 — patch existing materialized tool rows with precise descriptions. 0 OpenAI. */
import { pgrest } from '../src/lib/agent-mission-control/postgrest'
import { TRADING_TOOL_DESCRIPTIONS } from '../src/lib/agent-mission-control/market/tool-descriptions'

async function main() {
  let patched = 0
  for (const [name, description] of Object.entries(TRADING_TOOL_DESCRIPTIONS)) {
    const rows = await pgrest<Array<{ id: string }>>(
      'PATCH',
      `tools?name=eq.${encodeURIComponent(name)}`,
      { description },
    )
    patched += Array.isArray(rows) ? rows.length : 0
    console.log(`patched ${name}: ${Array.isArray(rows) ? rows.length : '?'} rows`)
  }
  console.log(JSON.stringify({ patched }, null, 2))
}
main().catch((e) => { console.error(e); process.exit(1) })
