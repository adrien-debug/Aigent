/**
 * AIG-AGENT-QUALITY-005 — Lot E: HITL end-to-end proof against the REAL
 * LangGraph Agent Server (:2024) via the app's run/resume routes (:3210).
 * Two runs: REJECT cycle then APPROVE cycle. Captures the persisted truth
 * (tool_calls, agent_runs status/cost/resolved_model) from gpu1 PostgREST.
 * Bounded: exactly 2 runs. No retries. Prints RESULT json lines.
 */
import path from 'node:path'
process.loadEnvFile(path.resolve(process.cwd(), '.env.local'))

const BASE = `http://127.0.0.1:${Number(process.env.AIGENT_DEV_PORT) || 3210}`
const COPILOT = 'copilot-agent-builder-copilot-69d941fc'
const KEY = process.env.AMC_API_KEY
const PG = process.env.AMC_SUPABASE_URL
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { 'x-amc-key': KEY, 'Content-Type': 'application/json' }

async function pg(q) {
  const r = await fetch(`${PG}/rest/v1/${q}`, { headers: { Authorization: `Bearer ${SRK}`, apikey: SRK }, cache: 'no-store' })
  return r.ok ? r.json() : null
}
async function run(userInput) {
  const r = await fetch(`${BASE}/api/agent-ops/copilots/${COPILOT}/run`, {
    method: 'POST', headers: H, body: JSON.stringify({ userInput }), signal: AbortSignal.timeout(120_000),
  })
  return { http: r.status, body: await r.json().catch(() => ({})) }
}
async function resume(runId, approved) {
  const r = await fetch(`${BASE}/api/agent-ops/copilots/${COPILOT}/runs/${runId}/resume`, {
    method: 'POST', headers: H, body: JSON.stringify({ approved }), signal: AbortSignal.timeout(120_000),
  })
  return { http: r.status, body: await r.json().catch(() => ({})) }
}
const P = 'Draft a copilot spec for a log triage agent.'

// count copilots before (materialization side-effect check)
const before = await pg('copilots?select=id')
console.log('RESULT ' + JSON.stringify({ step: 'baseline', copilotCount: before?.length ?? null }))

// ---- RUN 1: REJECT ----
const r1 = await run(P)
console.log('RESULT ' + JSON.stringify({ step: 'run1', http: r1.http, runId: r1.body.runId, status: r1.body.status, interrupted: r1.body.interrupted, pendingTool: r1.body.pendingTool?.name ?? null }))
if (r1.body.interrupted) {
  const tcBefore = await pg(`tool_calls?run_id=eq.${encodeURIComponent(r1.body.runId)}&select=tool_name,status`)
  console.log('RESULT ' + JSON.stringify({ step: 'run1.beforeDecision.toolCalls', rows: tcBefore }))
  const rej = await resume(r1.body.runId, false)
  console.log('RESULT ' + JSON.stringify({ step: 'run1.reject', http: rej.http, status: rej.body.status, ok: rej.body.ok }))
  const tcAfter = await pg(`tool_calls?run_id=eq.${encodeURIComponent(r1.body.runId)}&select=tool_name,status`)
  const arun = await pg(`agent_runs?id=eq.${encodeURIComponent(r1.body.runId)}&select=status,resolved_provider,resolved_model,model_unverified,cost_usd`)
  console.log('RESULT ' + JSON.stringify({ step: 'run1.afterReject', toolCalls: tcAfter, agentRun: arun?.[0] ?? null }))
}

// ---- RUN 2: APPROVE ----
const r2 = await run(P)
console.log('RESULT ' + JSON.stringify({ step: 'run2', http: r2.http, runId: r2.body.runId, status: r2.body.status, interrupted: r2.body.interrupted, pendingTool: r2.body.pendingTool?.name ?? null }))
if (r2.body.interrupted) {
  const app = await resume(r2.body.runId, true)
  console.log('RESULT ' + JSON.stringify({ step: 'run2.approve', http: app.http, status: app.body.status, ok: app.body.ok }))
  const tc = await pg(`tool_calls?run_id=eq.${encodeURIComponent(r2.body.runId)}&select=tool_name,status`)
  const arun = await pg(`agent_runs?id=eq.${encodeURIComponent(r2.body.runId)}&select=status,resolved_provider,resolved_model,model_unverified,cost_usd`)
  console.log('RESULT ' + JSON.stringify({ step: 'run2.afterApprove', toolCalls: tc, agentRun: arun?.[0] ?? null }))
}

// materialization side-effect: copilots count must be unchanged (draft never persists a copilot)
const after = await pg('copilots?select=id')
console.log('RESULT ' + JSON.stringify({ step: 'final', copilotCountAfter: after?.length ?? null, delta: (after?.length ?? 0) - (before?.length ?? 0) }))
