#!/usr/bin/env node
/**
 * AIGENT-REALESTATE-001 — one real proof run of the Valuation Agent (💲 OpenAI).
 *
 * This is the run that turns "Inactive" into a proven agent: it invokes the
 * copilot on a real Antibes address through the LangGraph runtime (the same
 * assistant the reprovision step wired), so we can SEE it call its real tools
 * (resolve_address_to_section → read_dvf_comparables → read_market_listings)
 * against live public data — not the graph's legacy generic tools.
 *
 * It does NOT activate the agent. It produces the evidence (a completed run
 * with tool calls) that a human reviews before activation (spec §17).
 *
 * Run against the LOCAL LangGraph server, never the remote endpoint:
 *   LANGGRAPH_API_URL=http://127.0.0.1:2024 \
 *     node --env-file=.env.local "$(command -v npx)" -y tsx \
 *     --conditions=react-server scripts/prove-valuation-agent.mjs
 */

const COPILOT_ID = 'cop-valuation-agent'
const VERSION_ID = 'ver-valuation-agent-v1'
const PROJECT_ID = 'proj-real-estate-agent'
const MODEL = 'gpt-5.4'
const PROVIDER = 'openai'

// A real, resolvable address in Antibes (proven live: → INSEE 06004, section 000AH).
const USER_INPUT =
  'Estime la valeur de marché de ce bien : appartement, environ 85 m², ' +
  "4 pièces, situé au 24 Boulevard des Lentisques, 06600 Antibes. " +
  "Résous d'abord l'adresse en section cadastrale, puis lis les ventes DVF " +
  'confirmées comparables. Donne une fourchette argumentée et cite la ' +
  'provenance de chaque chiffre. Si une source est indisponible, dis-le — ' +
  "n'invente aucun comparable."

async function main() {
  const { executeCopilotRun } = await import('../src/lib/agent-mission-control/runner.ts')

  console.log(`Proof run — ${COPILOT_ID} (${MODEL}/${PROVIDER}, langgraph)`)
  console.log(`Input: ${USER_INPUT.slice(0, 90)}…\n`)

  const started = Date.now()
  const result = await executeCopilotRun({
    copilotId: COPILOT_ID,
    versionId: VERSION_ID,
    projectId: PROJECT_ID,
    model: MODEL,
    modelProvider: PROVIDER,
    runtime: 'langgraph',
    systemPromptSummary:
      'You are the Valuation Agent. Resolve the address to a cadastral section, ' +
      'read confirmed DVF sales, and produce a documented value range. Never invent ' +
      'a comparable: on UNAVAILABLE say so. Distinguish signed (DVF, HISTORICAL) from ' +
      'asking prices. Every figure carries its provenance.',
    userInput: USER_INPUT,
    maxSteps: 10,
  })

  const ms = Date.now() - started
  console.log(`\n── run finished in ${(ms / 1000).toFixed(1)}s ──`)
  console.log(`runId:           ${result.runId}`)
  console.log(`status:          ${result.status}`)
  console.log(`tool_call_count: ${result.toolCallCount}`)
  console.log(`blocked_tools:   ${result.blockedToolCount}`)
  if (result.toolCalls?.length) {
    console.log('tools called:')
    for (const t of result.toolCalls) {
      console.log(`  - ${t.name} [${t.status}]`)
    }
  } else {
    console.log('tools called:    (none — check this is not the legacy-tools silent fallback)')
  }
  console.log(`\n── outputSummary (first 1400 chars) ──\n${String(result.outputSummary ?? '').slice(0, 1400)}`)

  // Dump the full result to a file for inspection without flooding the console.
  const fs = await import('node:fs')
  fs.writeFileSync(
    '/tmp/valuation-proof-run.json',
    JSON.stringify(result, null, 2),
  )
  console.log('\nfull result → /tmp/valuation-proof-run.json')
}

main().catch((e) => {
  console.error('\n✗ proof run failed:', e?.message ?? e)
  process.exit(1)
})
