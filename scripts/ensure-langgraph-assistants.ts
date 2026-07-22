/**
 * Provision a LangGraph assistant for every copilot.
 *
 * Step 1 of the "LangGraph mandatory" migration: a copilot whose `runtime` is
 * 'langgraph' but which has NO assistant does not fail — it silently falls back
 * to the graph's 5 legacy generic tools (see langgraph-server.ts's
 * `runConfigWithAssistantBehavior`), so a market agent answers "no data" with
 * tool_call_count=0 while looking healthy. Provisioning the assistant is what
 * transports the copilot's real tools/prompt/model into the graph, and it must
 * happen BEFORE the runtime flip.
 *
 * Idempotent: `ensureCopilotAssistant` derives a deterministic assistant id,
 * creates with ifExists:'do_nothing', then pushes the current config — so a
 * re-run refreshes behaviour rather than duplicating assistants.
 *
 * Read-only against Postgres; the only writes go to the LangGraph agent server.
 *
 *   node --env-file=.env.local npx -y tsx scripts/ensure-langgraph-assistants.ts
 */
import {
  ensureCopilotAssistant,
  assistantIdForCopilot,
} from '../src/lib/agent-mission-control/langgraph-assistants'

const url = process.env.AMC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('AMC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  process.exit(1)
}

async function pg(path: string): Promise<Array<Record<string, unknown>>> {
  const r = await fetch(`${url}/${path}`, {
    headers: { apikey: key as string, Authorization: `Bearer ${key}` },
  })
  if (!r.ok) throw new Error(`${path} → ${r.status} ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

async function main() {
  const copilots = await pg('copilots?select=id,name,runtime,status&order=name')
  console.log(`${copilots.length} copilot(s) to provision\n`)

  let ok = 0
  const failures: string[] = []
  for (const c of copilots) {
    const id = c.id as string
    const name = String(c.name)
    try {
      const assistantId = await ensureCopilotAssistant({ copilotId: id })
      console.log(`✓ ${name.padEnd(26)} assistant=${assistantId}`)
      ok++
    } catch (e) {
      const msg = (e as Error).message
      console.log(`✗ ${name.padEnd(26)} ${msg}`)
      console.log(`   expected id: ${assistantIdForCopilot(id)}`)
      failures.push(`${name}: ${msg}`)
    }
  }

  console.log(`\n${ok}/${copilots.length} assistants provisioned`)
  if (failures.length > 0) {
    console.error('\nFAILED — runtime flip must NOT proceed:')
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
