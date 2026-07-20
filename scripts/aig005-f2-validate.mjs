/**
 * AIG-AGENT-QUALITY-005 — Lot F2: one bounded real run per NEVER_RUN_MISLEADING
 * agent (all read-only tools → safe, no destructive effect possible). Captures
 * the persisted truth from gpu1: status, resolved provider/model, cost (must be
 * NULL now — proves F1 write path), tool_calls, no side effect (copilot count).
 */
import path from 'node:path'
import { PROMOTED_MARKET_AGENTS } from '../src/lib/agent-mission-control/market/promoted-tool-mapping.mjs'
process.loadEnvFile(path.resolve(process.cwd(), '.env.local'))
const BASE = `http://127.0.0.1:${Number(process.env.AIGENT_DEV_PORT) || 3210}`
const KEY = process.env.AMC_API_KEY
const PG = process.env.AMC_SUPABASE_URL
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { 'x-amc-key': KEY, 'Content-Type': 'application/json' }
const pg = async (q) => { const r = await fetch(`${PG}/rest/v1/${q}`, { headers: { Authorization: `Bearer ${SRK}`, apikey: SRK }, cache: 'no-store' }); return r.ok ? r.json() : null }

const before = (await pg('copilots?select=id'))?.length ?? null
console.log('RESULT ' + JSON.stringify({ step: 'baseline', copilots: before }))

for (const agent of PROMOTED_MARKET_AGENTS) {
  const id = agent.id
  try {
    const r = await fetch(`${BASE}/api/agent-ops/copilots/${id}/run`, {
      method: 'POST', headers: H, body: JSON.stringify({ userInput: agent.scenario }), signal: AbortSignal.timeout(120_000),
    })
    const b = await r.json().catch(() => ({}))
    let dbRow = null, tools = null
    if (b.runId) {
      const arun = await pg(`agent_runs?id=eq.${encodeURIComponent(b.runId)}&select=status,resolved_provider,resolved_model,model_unverified,cost_usd,trace_url,tool_call_count,unsafe_attempt_count,output_summary`)
      dbRow = arun?.[0] ?? null
      tools = await pg(`tool_calls?run_id=eq.${encodeURIComponent(b.runId)}&select=tool_name,status,result_summary,required_confirmation,latency_ms`)
    }
    console.log('RESULT ' + JSON.stringify({
      step: 'run', agent: agent.name,
      http: r.status, runId: b.runId, apiStatus: b.status, interrupted: b.interrupted,
      db: dbRow, toolCalls: tools,
    }))
  } catch (e) {
    console.log('RESULT ' + JSON.stringify({ step: 'run', agent: id, error: String(e).slice(0, 120) }))
  }
}
const after = (await pg('copilots?select=id'))?.length ?? null
console.log('RESULT ' + JSON.stringify({ step: 'final', copilots: after, delta: (after ?? 0) - (before ?? 0) }))
