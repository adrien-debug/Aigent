/**
 * Live tests (opt-in: npm run test:live) — the two DB bypasses closed by the
 * 74257ea review and migration 0032, proven against gpu1 with the REAL app role
 * (service_role, which has BYPASSRLS + a full UPDATE grant).
 *
 * REWORK 2 — a direct write to status=active / stage=production / production_version_id
 *            is REFUSED at the DB (trigger), while the official RPC still works.
 * REWORK 1 — the freshness TTL is server-authoritative: a caller-supplied value
 *            can only SHORTEN the window, never widen it; a stale gate is refused
 *            no matter how large a p_max_evidence_age_seconds is passed.
 *
 * Every row is created in a throwaway namespace and torn down in afterAll.
 * Self-skips (never fails) when gpu1 is not configured. Zero billed LLM call.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const BASE = process.env.AMC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const LIVE = process.env.AMC_DATA_SOURCE === 'gpu1' && !!BASE && !!KEY
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' } as Record<string, string>

const token = Math.random().toString(36).slice(2, 10)
const cop = `cop-lockdown-${token}`
const man = `man-lockdown-${token}`
const verA = `ver-a-${token}` // forward-promotion candidate
const verB = `ver-b-${token}` // second candidate (for rollback target setup)

async function rest(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) })
  return { status: res.status, text: await res.text() }
}
const rpc = (b: unknown) => rest('POST', 'rpc/promote_copilot_version', b)
async function persistGate(versionId: string, ageSeconds = 0) {
  const at = new Date(Date.now() - ageSeconds * 1000).toISOString()
  return rest('POST', 'promotion_gates', {
    id: `gate-${versionId}-${Math.random().toString(36).slice(2, 8)}`, copilot_id: cop, candidate_version_id: versionId,
    target_stage: 'production', checks: [], overall_status: 'ready', gate_result: 'PASS', registry_hash: 't', evidence_hash: 't', last_evaluated_at: at,
  })
}
async function stageOf(id: string) { return (await rest('GET', `copilot_versions?id=eq.${id}&select=stage`)).text }
async function statusOf() { return (await rest('GET', `copilots?id=eq.${cop}&select=status,production_version_id`)).text }

beforeAll(async () => {
  if (!LIVE) return
  const now = new Date().toISOString()
  await rest('POST', 'copilots', {
    id: cop, project_id: null, target_project_ids: [], name: `LOCKDOWN-LIVE ${token}`, slug: `lockdown-live-${token}`, description: 'x',
    runtime: 'langgraph', status: 'draft', production_version_id: null, latest_version_id: verA, model: 'gpt-5.4', model_provider: 'openai',
    owner: 'test', tags: ['test'], created_at: now, updated_at: now, health: {}, created_via: 'authoring',
  })
  await rest('POST', 'manifests', {
    id: man, copilot_id: cop, version: 'v', system_prompt_summary: 'x', allowed_routes: [], forbidden_actions: [], confirmation_policy: 'never',
    always_confirm_actions: [], memory_sources: [], output_contract: { format: 'json', schemaName: null, invariants: [] }, skills: [], tool_ids: [],
    max_steps_per_run: 4, max_cost_per_run_usd: 0.5, updated_at: now,
  })
  for (const id of [verA, verB]) {
    await rest('POST', 'copilot_versions', { id, copilot_id: cop, label: 'v', stage: 'draft', manifest_id: man, model: 'gpt-5.4', model_provider: 'openai', changelog: 'x', created_at: now, created_by: 'test', scores: {} })
  }
}, 40_000)

afterAll(async () => {
  if (!LIVE) return
  await rest('DELETE', `promotion_gates?copilot_id=eq.${cop}`)
  await rest('DELETE', `copilots?id=eq.${cop}`)
}, 40_000)

describe('REWORK 2 — direct write to active/production is refused at the DB (0032 trigger)', () => {
  it('1) PATCH copilot_versions.stage=production directly → refused, version stays draft', async () => {
    if (!LIVE) return console.warn('[live] skip: gpu1 not configured')
    const r = await rest('PATCH', `copilot_versions?id=eq.${verA}`, { stage: 'production' })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(r.text).toMatch(/direct transition to stage=production is forbidden/)
    expect(await stageOf(verA)).toContain('draft')
  })

  it('2) PATCH copilots.status=active directly → refused, copilot stays draft', async () => {
    if (!LIVE) return console.warn('[live] skip')
    const r = await rest('PATCH', `copilots?id=eq.${cop}`, { status: 'active' })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(r.text).toMatch(/direct transition to status=active is forbidden/)
    expect(await statusOf()).toContain('draft')
  })

  it('2b) PATCH copilots.production_version_id directly → refused', async () => {
    if (!LIVE) return console.warn('[live] skip')
    const r = await rest('PATCH', `copilots?id=eq.${cop}`, { production_version_id: verA })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(r.text).toMatch(/direct change of production_version_id is forbidden/)
  })

  it('3) combined direct PATCH (status+production_version_id) → refused, no partial state', async () => {
    if (!LIVE) return console.warn('[live] skip')
    const r = await rest('PATCH', `copilots?id=eq.${cop}`, { status: 'active', production_version_id: verA })
    expect(r.status).toBeGreaterThanOrEqual(400)
    const s = await statusOf()
    expect(s).toContain('draft')
    expect(s).toContain('"production_version_id":null')
  })

  it('control) a benign PATCH (updated_at) still works', async () => {
    if (!LIVE) return console.warn('[live] skip')
    const r = await rest('PATCH', `copilots?id=eq.${cop}`, { updated_at: new Date().toISOString() })
    expect(r.status).toBeLessThan(300)
  })

  it('5) official RPC WITHOUT a fresh gate → refused', async () => {
    if (!LIVE) return console.warn('[live] skip')
    const r = await rpc({ p_copilot_id: cop, p_version_id: verA, p_previous_prod: null, p_is_rollback: false })
    expect(r.status).toBe(400)
    expect(r.text).toMatch(/no gate evaluation|not a fresh PASS/)
    expect(await statusOf()).toContain('draft')
  })

  it('6) official RPC WITH a fresh gate → accepted → active/production', async () => {
    if (!LIVE) return console.warn('[live] skip')
    await persistGate(verA, 0)
    const r = await rpc({ p_copilot_id: cop, p_version_id: verA, p_previous_prod: null, p_is_rollback: false })
    expect(r.status).toBeLessThan(300)
    const s = await statusOf()
    expect(s).toContain('active')
    expect(s).toContain(verA)
    expect(await stageOf(verA)).toContain('production')
  })

  it('7) official rollback to an archived version → accepted (RPC path only)', async () => {
    if (!LIVE) return console.warn('[live] skip')
    // Promote verB (archives verA), then roll back to verA (now archived).
    await persistGate(verB, 0)
    const up = await rpc({ p_copilot_id: cop, p_version_id: verB, p_previous_prod: verA, p_is_rollback: false })
    expect(up.status).toBeLessThan(300)
    expect(await stageOf(verA)).toContain('archived')
    const rb = await rpc({ p_copilot_id: cop, p_version_id: verA, p_previous_prod: verB, p_is_rollback: true })
    expect(rb.status).toBeLessThan(300)
    expect(await stageOf(verA)).toContain('production')
  })

  it('8) no partial state persists after any refused attempt (final state is coherent)', async () => {
    if (!LIVE) return console.warn('[live] skip')
    // After all the above, exactly one production version exists for the copilot.
    const prod = await rest('GET', `copilot_versions?copilot_id=eq.${cop}&stage=eq.production&select=id`)
    expect((JSON.parse(prod.text) as unknown[]).length).toBe(1)
  })
})

describe('REWORK 1 — the freshness TTL is server-authoritative (0032 clamp)', () => {
  const verC = `ver-c-${token}`
  const cop2 = `cop-ttl-${token}`
  beforeAll(async () => {
    if (!LIVE) return
    const now = new Date().toISOString()
    await rest('POST', 'copilots', { id: cop2, project_id: null, target_project_ids: [], name: `TTL-LIVE ${token}`, slug: `ttl-live-${token}`, description: 'x', runtime: 'langgraph', status: 'draft', production_version_id: null, latest_version_id: verC, model: 'gpt-5.4', model_provider: 'openai', owner: 'test', tags: ['test'], created_at: now, updated_at: now, health: {}, created_via: 'authoring' })
    await rest('POST', 'copilot_versions', { id: verC, copilot_id: cop2, label: 'v', stage: 'draft', manifest_id: man, model: 'gpt-5.4', model_provider: 'openai', changelog: 'x', created_at: now, created_by: 'test', scores: {} })
  }, 40_000)
  afterAll(async () => {
    if (!LIVE) return
    await rest('DELETE', `promotion_gates?copilot_id=eq.${cop2}`)
    await rest('DELETE', `copilots?id=eq.${cop2}`)
  }, 40_000)
  const gateStale = () => rest('POST', 'promotion_gates', { id: `g-stale-${token}`, copilot_id: cop2, candidate_version_id: verC, target_stage: 'production', checks: [], overall_status: 'ready', gate_result: 'PASS', registry_hash: 't', evidence_hash: 't', last_evaluated_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString() })
  const rpc2 = (ttl: number) => rest('POST', 'rpc/promote_copilot_version', { p_copilot_id: cop2, p_version_id: verC, p_previous_prod: null, p_is_rollback: false, p_max_evidence_age_seconds: ttl })

  it('1) a >1h-old gate + caller TTL=999999999 → refused (clamp to server max 3600 wins)', async () => {
    if (!LIVE) return console.warn('[live] skip')
    await gateStale()
    const r = await rpc2(999_999_999)
    expect(r.status).toBe(400)
    expect(r.text).toMatch(/not a fresh PASS within 3600 s/)
  })

  it('3a) negative TTL → fail-closed (clamped to max, stale gate still refused)', async () => {
    if (!LIVE) return console.warn('[live] skip')
    const r = await rpc2(-1)
    expect(r.status).toBe(400)
    expect(r.text).toMatch(/within 3600 s/)
  })

  it('3b) TTL=0 → fail-closed (clamped to max, stale gate still refused)', async () => {
    if (!LIVE) return console.warn('[live] skip')
    const r = await rpc2(0)
    expect(r.status).toBe(400)
  })

  it('2) a genuinely FRESH gate → accepted (the clamp never blocks a fresh PASS)', async () => {
    if (!LIVE) return console.warn('[live] skip')
    await rest('PATCH', `promotion_gates?id=eq.g-stale-${token}`, { last_evaluated_at: new Date().toISOString() })
    const r = await rpc2(999_999_999)
    expect(r.status).toBeLessThan(300)
    expect((await rest('GET', `copilots?id=eq.${cop2}&select=status`)).text).toContain('active')
  })

  it('4+5) only ONE overload exists and PostgREST offers no alternative free-TTL call', async () => {
    if (!LIVE) return console.warn('[live] skip')
    // A 3-key body resolves cleanly to the single 5-arg overload (defaults) — no
    // ambiguity, no historical free-TTL signature to route around the clamp.
    const r = await rest('POST', 'rpc/promote_copilot_version', { p_copilot_id: '__x__', p_version_id: '__x__', p_previous_prod: null } as unknown)
    expect(r.status).toBe(400)
    expect(r.text).toMatch(/does not belong to copilot/) // the hardened body ran
  })
})
