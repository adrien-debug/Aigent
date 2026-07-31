/**
 * Live tests (opt-in: npm run test:live) — the FORGEABLE-GUC P0 (0032) closed by
 * migration 0033 via privilege separation, proven against gpu1 with the REAL app
 * role service_role, INCLUDING the case where service_role fully controls its own
 * transaction and session and forges the app.promotion GUC.
 *
 * The boundary is no longer a session value: the transition columns are owned by
 * a protected NOLOGIN role (aigent_promotion_executor) that service_role is not a
 * member of; service_role's column-UPDATE grant on status/production_version_id/
 * stage is revoked; and a SECURITY INVOKER trigger checks current_user. Only the
 * RPC (SECURITY DEFINER owned by the executor) transitions.
 *
 * Two channels: PostgREST (each request its own tx) here, plus an SQL-level
 * forged-GUC path exercised in the migration proof (SQL recorded in git history
 * under the former docs/runtime-promotion-001.md — not runnable from CI).
 *
 * Throwaway namespace, torn down in afterAll. Self-skips without gpu1. $0.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const BASE = process.env.AMC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const LIVE = process.env.AMC_DATA_SOURCE === 'gpu1' && !!BASE && !!KEY
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' } as Record<string, string>

const token = Math.random().toString(36).slice(2, 10)
const cop = `cop-privsep-${token}`
const man = `man-privsep-${token}`
const verA = `ver-a-${token}`
const verB = `ver-b-${token}`

async function rest(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) })
  return { status: res.status, text: await res.text() }
}
const rpc = (b: unknown) => rest('POST', 'rpc/promote_copilot_version', b)
async function gate(versionId: string, ageSeconds = 0) {
  return rest('POST', 'promotion_gates', { id: `g-${versionId}-${Math.random().toString(36).slice(2, 8)}`, copilot_id: cop, candidate_version_id: versionId, target_stage: 'production', checks: [], overall_status: 'ready', gate_result: 'PASS', registry_hash: 't', evidence_hash: 't', last_evaluated_at: new Date(Date.now() - ageSeconds * 1000).toISOString() })
}
const statusOf = async () => (await rest('GET', `copilots?id=eq.${cop}&select=status,production_version_id`)).text
const stageOf = async (id: string) => (await rest('GET', `copilot_versions?id=eq.${id}&select=stage`)).text
/** A refusal = the transition was blocked (column privilege OR trigger). */
const refused = (r: { status: number; text: string }) => r.status >= 400 && /permission denied|forbidden|insufficient_privilege|42501/i.test(r.text)

beforeAll(async () => {
  if (!LIVE) return
  const now = new Date().toISOString()
  await rest('POST', 'copilots', { id: cop, project_id: null, target_project_ids: [], name: `PRIVSEP-LIVE ${token}`, slug: `privsep-live-${token}`, description: 'x', runtime: 'langgraph', status: 'draft', production_version_id: null, latest_version_id: verA, model: 'gpt-5.4', model_provider: 'openai', owner: 'test', tags: ['test'], created_at: now, updated_at: now, health: {}, created_via: 'authoring' })
  await rest('POST', 'manifests', { id: man, copilot_id: cop, version: 'v', system_prompt_summary: 'x', allowed_routes: [], forbidden_actions: [], confirmation_policy: 'never', always_confirm_actions: [], memory_sources: [], output_contract: { format: 'json', schemaName: null, invariants: [] }, skills: [], tool_ids: [], max_steps_per_run: 4, max_cost_per_run_usd: 0.5, updated_at: now })
  for (const id of [verA, verB]) await rest('POST', 'copilot_versions', { id, copilot_id: cop, label: 'v', stage: 'draft', manifest_id: man, model: 'gpt-5.4', model_provider: 'openai', changelog: 'x', created_at: now, created_by: 'test', scores: {} })
}, 40_000)

afterAll(async () => {
  if (!LIVE) return
  await rest('DELETE', `promotion_gates?copilot_id=eq.${cop}`)
  await rest('DELETE', `copilots?id=eq.${cop}`)
}, 40_000)

describe('REWORK P0 — forgeable-GUC bypass closed by privilege separation (0033)', () => {
  it('1) direct PATCH status=active WITHOUT the RPC → refused', async () => {
    if (!LIVE) return console.warn('[live] skip: gpu1 not configured')
    expect(refused(await rest('PATCH', `copilots?id=eq.${cop}`, { status: 'active' }))).toBe(true)
    expect(await statusOf()).toContain('draft')
  })

  it('5) direct PATCH production_version_id → refused', async () => {
    if (!LIVE) return console.warn('[live] skip')
    expect(refused(await rest('PATCH', `copilots?id=eq.${cop}`, { production_version_id: verA }))).toBe(true)
  })

  it('6) direct PATCH copilot_versions.stage=production → refused', async () => {
    if (!LIVE) return console.warn('[live] skip')
    expect(refused(await rest('PATCH', `copilot_versions?id=eq.${verA}`, { stage: 'production' }))).toBe(true)
    expect(await stageOf(verA)).toContain('draft')
  })

  it('4) combined direct PATCH → refused, no partial state', async () => {
    if (!LIVE) return console.warn('[live] skip')
    expect(refused(await rest('PATCH', `copilots?id=eq.${cop}`, { status: 'active', production_version_id: verA }))).toBe(true)
    const s = await statusOf()
    expect(s).toContain('draft')
    expect(s).toContain('"production_version_id":null')
  })

  it('13) benign columns still writable by service_role (app keeps working)', async () => {
    if (!LIVE) return console.warn('[live] skip')
    expect((await rest('PATCH', `copilots?id=eq.${cop}`, { updated_at: new Date().toISOString() })).status).toBeLessThan(300)
    expect((await rest('PATCH', `copilots?id=eq.${cop}`, { assistant_id: 'a-test' })).status).toBeLessThan(300)
  })

  it('7) official RPC WITHOUT a fresh gate → refused', async () => {
    if (!LIVE) return console.warn('[live] skip')
    const r = await rpc({ p_copilot_id: cop, p_version_id: verA, p_previous_prod: null, p_is_rollback: false })
    expect(r.status).toBe(400)
    expect(r.text).toMatch(/no gate evaluation|not a fresh PASS/)
  })

  it('8) official RPC WITH a fresh gate → accepted → active/production', async () => {
    if (!LIVE) return console.warn('[live] skip')
    await gate(verA, 0)
    expect((await rpc({ p_copilot_id: cop, p_version_id: verA, p_previous_prod: null, p_is_rollback: false })).status).toBeLessThan(300)
    const s = await statusOf()
    expect(s).toContain('active')
    expect(s).toContain(verA)
    expect(await stageOf(verA)).toContain('production')
  })

  it('9) official rollback to an archived version → accepted', async () => {
    if (!LIVE) return console.warn('[live] skip')
    await gate(verB, 0)
    expect((await rpc({ p_copilot_id: cop, p_version_id: verB, p_previous_prod: verA, p_is_rollback: false })).status).toBeLessThan(300)
    expect(await stageOf(verA)).toContain('archived')
    expect((await rpc({ p_copilot_id: cop, p_version_id: verA, p_previous_prod: verB, p_is_rollback: true })).status).toBeLessThan(300)
    expect(await stageOf(verA)).toContain('production')
  })

  it('12) exactly one production version after all transitions (no partial/incoherent state)', async () => {
    if (!LIVE) return console.warn('[live] skip')
    const prod = await rest('GET', `copilot_versions?copilot_id=eq.${cop}&stage=eq.production&select=id`)
    expect((JSON.parse(prod.text) as unknown[]).length).toBe(1)
  })
})

describe('REWORK TTL — single semantics (0033): NULL/0/negative = error, 1..3600 ok, >3600 clamped', () => {
  const cop2 = `cop-ttl2-${token}`
  const verC = `ver-c-${token}`
  beforeAll(async () => {
    if (!LIVE) return
    const now = new Date().toISOString()
    await rest('POST', 'copilots', { id: cop2, project_id: null, target_project_ids: [], name: `TTL2 ${token}`, slug: `ttl2-${token}`, description: 'x', runtime: 'langgraph', status: 'draft', production_version_id: null, latest_version_id: verC, model: 'gpt-5.4', model_provider: 'openai', owner: 'test', tags: ['test'], created_at: now, updated_at: now, health: {}, created_via: 'authoring' })
    await rest('POST', 'copilot_versions', { id: verC, copilot_id: cop2, label: 'v', stage: 'draft', manifest_id: man, model: 'gpt-5.4', model_provider: 'openai', changelog: 'x', created_at: now, created_by: 'test', scores: {} })
  }, 40_000)
  afterAll(async () => { if (!LIVE) return; await rest('DELETE', `promotion_gates?copilot_id=eq.${cop2}`); await rest('DELETE', `copilots?id=eq.${cop2}`) }, 40_000)
  const rpc2 = (ttl: number | null) => rest('POST', 'rpc/promote_copilot_version', { p_copilot_id: cop2, p_version_id: verC, p_previous_prod: null, p_is_rollback: false, p_max_evidence_age_seconds: ttl })
  const staleGate = () => rest('POST', 'promotion_gates', { id: `g-stale-${token}`, copilot_id: cop2, candidate_version_id: verC, target_stage: 'production', checks: [], overall_status: 'ready', gate_result: 'PASS', registry_hash: 't', evidence_hash: 't', last_evaluated_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString() })

  it('11a) TTL=NULL → hard error (fail-closed), not a silent fallback', async () => {
    if (!LIVE) return console.warn('[live] skip')
    await staleGate()
    const r = await rpc2(null)
    expect(r.status).toBe(400)
    expect(r.text).toMatch(/invalid p_max_evidence_age_seconds/)
  })
  it('11b) TTL=0 → hard error', async () => {
    if (!LIVE) return console.warn('[live] skip')
    expect((await rpc2(0)).text).toMatch(/invalid p_max_evidence_age_seconds/)
  })
  it('11c) TTL negative → hard error', async () => {
    if (!LIVE) return console.warn('[live] skip')
    expect((await rpc2(-5)).text).toMatch(/invalid p_max_evidence_age_seconds/)
  })
  it('10) TTL huge (>3600) with a stale gate → refused (clamped to 3600, stale wins)', async () => {
    if (!LIVE) return console.warn('[live] skip')
    const r = await rpc2(999_999_999)
    expect(r.status).toBe(400)
    expect(r.text).toMatch(/not a fresh PASS within 3600 s/)
  })
  it('a valid 1..3600 TTL with a fresh gate → accepted', async () => {
    if (!LIVE) return console.warn('[live] skip')
    await rest('PATCH', `promotion_gates?id=eq.g-stale-${token}`, { last_evaluated_at: new Date().toISOString() })
    expect((await rpc2(1800)).status).toBeLessThan(300)
    expect((await rest('GET', `copilots?id=eq.${cop2}&select=status`)).text).toContain('active')
  })
})
