#!/usr/bin/env node
/**
 * TradeAgent scorecard — reads live runs and prints dimension scores.
 * No OpenAI. Usage: node --env-file=.env.local scripts/scorecard-tradeagent.mjs [copilotId]
 */
import { assessMarketIntelligenceOperatorRun, MARKET_INTELLIGENCE_TOOL_IDS } from '../src/lib/agent-mission-control/market/eval/operator-run-quality.ts'

const base = process.env.AMC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) {
  console.error('backend not configured')
  process.exit(2)
}

const H = { apikey: key, Authorization: `Bearer ${key}` }
const COPILOT = process.argv[2] ?? 'copilot-market-intelligence'

const DIMENSIONS = [
  { id: 'execution', weight: 0.25, label: 'Tools montés & exécutables' },
  { id: 'tool-breadth', weight: 0.2, label: 'Couverture outils (≥4/5)' },
  { id: 'provenance', weight: 0.15, label: 'Provenance/fraîcheur dans la sortie' },
  { id: 'governance', weight: 0.2, label: 'Statut prod + gate' },
  { id: 'safety', weight: 0.2, label: 'Tests safety passés' },
]

async function get(path) {
  const r = await fetch(`${base}/rest/v1/${path}`, { headers: H })
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json()
}

function score(dim, value) {
  return { dimension: dim.id, label: dim.label, score: value, weighted: value * dim.weight }
}

async function main() {
  const [cop] = await get(
    `copilots?id=eq.${encodeURIComponent(COPILOT)}&select=id,name,status,production_version_id`
  )
  if (!cop) throw new Error(`${COPILOT} not found`)

  const tools = await get(`tools?copilot_id=eq.${encodeURIComponent(COPILOT)}&enabled=eq.true&select=name`)
  const runs = await get(
    `agent_runs?copilot_id=eq.${encodeURIComponent(COPILOT)}&status=eq.completed&select=id,tool_call_count,output_summary&order=started_at.desc&limit=5`
  )

  let allToolNames = []
  for (const run of runs) {
    const calls = await get(`tool_calls?run_id=eq.${run.id}&select=tool_name`)
    if (Array.isArray(calls)) allToolNames.push(...calls.map((c) => c.tool_name))
  }
  const unique = [...new Set(allToolNames)]
  const lastRun = runs[0]
  const quality = lastRun
    ? assessMarketIntelligenceOperatorRun({
        actualToolNames: unique,
        outputText: lastRun.output_summary ?? '',
      })
    : null

  const [testRun] = await get(
    `test_runs?copilot_id=eq.${encodeURIComponent(COPILOT)}&status=eq.completed&select=pass_rate&order=started_at.desc&limit=1`
  )

  const executionOk = tools.length >= 5 && runs.some((r) => r.tool_call_count > 0)
  const breadthOk = unique.filter((t) => MARKET_INTELLIGENCE_TOOL_IDS.includes(t)).length >= 4
  const governanceOk = cop.status === 'active' && cop.production_version_id != null
  const safetyOk = testRun ? testRun.pass_rate >= 1 : false

  let breadthScore = 0.5
  if (breadthOk) breadthScore = 1
  else if (quality?.toolBreadthOk) breadthScore = 0.8

  const lines = [
    score(DIMENSIONS[0], executionOk ? 1 : 0),
    score(DIMENSIONS[1], breadthScore),
    score(DIMENSIONS[2], quality?.provenanceMentioned ? 1 : 0.5),
    score(DIMENSIONS[3], governanceOk ? 1 : 0.4),
    score(DIMENSIONS[4], safetyOk ? 1 : 0),
  ]
  const global = Math.round(lines.reduce((s, l) => s + l.weighted, 0) * 100) / 100

  console.log(`\nSCORECARD — ${cop.name} (${COPILOT})`)
  console.log(`global: ${(global * 10).toFixed(1)}/10\n`)
  for (const l of lines) {
    console.log(`  ${l.label.padEnd(36)} ${(l.score * 10).toFixed(1)}/10  (poids ${DIMENSIONS.find((d) => d.id === l.dimension).weight})`)
  }
  console.log(`\nlast run tools (unique, last 5 runs): ${unique.join(', ') || 'none'}`)
  if (quality?.warnings.length) console.log(`warnings: ${quality.warnings.join('; ')}`)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
