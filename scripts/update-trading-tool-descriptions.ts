/**
 * AIG-TRADE-001 — patch the trading roster's tool rows with precise descriptions.
 * 0 OpenAI. SCOPED + DRY-RUN by default.
 *
 * Previously this ran an UNSCOPED global `PATCH tools?name=eq.<name>`, so it
 * rewrote the description on EVERY copilot in the DB that happened to share a
 * tool name — a routine-sounding command that silently mutated tool contracts
 * across the whole platform. Now it:
 *   - resolves the target project's copilots and scopes every write to them;
 *   - DRY-RUNS by default (prints the rows it would change), writing only with
 *     an explicit `--apply` flag.
 *
 * Run (dry-run):  node --env-file=.env.local npx tsx scripts/update-trading-tool-descriptions.ts
 * Run (apply):    node --env-file=.env.local npx tsx scripts/update-trading-tool-descriptions.ts --apply
 */
import { pgrest } from '../src/lib/agent-mission-control/postgrest'
import { TRADING_TOOL_DESCRIPTIONS } from '../src/lib/agent-mission-control/market/tool-descriptions'

const TARGET_PROJECT_ID = 'proj-tradeagent'

async function main() {
  const apply = process.argv.includes('--apply')

  // Scope: only the target project's copilots. A tool row is patched ONLY when
  // it belongs to one of these — never a same-named tool on an unrelated copilot.
  const copilots = await pgrest<Array<{ id: string }>>(
    'GET',
    `copilots?project_id=eq.${encodeURIComponent(TARGET_PROJECT_ID)}&select=id`
  )
  const copilotIds = copilots.map((c) => c.id)
  if (copilotIds.length === 0) {
    console.error(`No copilots found in project ${TARGET_PROJECT_ID} — nothing to scope to. Aborting.`)
    process.exit(1)
  }
  const inList = copilotIds.map((id) => `"${id}"`).join(',')
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} — scoped to ${copilotIds.length} copilot(s) in ${TARGET_PROJECT_ID}`)

  let affected = 0
  for (const [name, description] of Object.entries(TRADING_TOOL_DESCRIPTIONS)) {
    const scope = `tools?copilot_id=in.(${inList})&name=eq.${encodeURIComponent(name)}`
    const current = await pgrest<Array<{ id: string; copilot_id: string }>>('GET', `${scope}&select=id,copilot_id`)
    if (current.length === 0) {
      console.log(`  ${name}: no matching tool rows in scope`)
      continue
    }
    if (!apply) {
      console.log(`  ${name}: would patch ${current.length} row(s) → ${current.map((r) => r.copilot_id).join(', ')}`)
      affected += current.length
      continue
    }
    const rows = await pgrest<Array<{ id: string }>>('PATCH', scope, { description })
    const n = Array.isArray(rows) ? rows.length : 0
    affected += n
    console.log(`  ${name}: patched ${n} row(s)`)
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', affected }, null, 2))
  if (!apply) console.log('\nDry-run only. Re-run with --apply to write.')
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
