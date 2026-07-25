/**
 * Live anti-bypass tests against gpu1 (opt-in: npm run test:live).
 *
 * Proves — against the REAL database, in a rollback-clean namespace — the DB-layer
 * promotion guarantees the PR #19 review hardened (migrations 0030 + 0031):
 *   - the ungated 3-arg overload is gone (only the 5-arg survives);
 *   - a forward promotion with NO fresh passing gate is REFUSED at the DB;
 *   - a rollback of a non-archived version is REFUSED at the DB (not just the route);
 *   - two concurrent promotions never produce two production versions (case 12);
 *   - the whole official promotion path works end to end (create→gate→promote).
 *
 * Each test self-skips (never fails) when gpu1 is not reachable. Every row it
 * writes is cleaned up in afterAll via deleteCopilotCascade + explicit deletes,
 * so it never pollutes production. Zero billed LLM call (no run here).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const BASE = process.env.AMC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const LIVE = process.env.AMC_DATA_SOURCE === 'gpu1' && !!BASE && !!KEY

const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' } as Record<string, string>
const token = Math.random().toString(36).slice(2, 10)
const copilotId = `copilot-antibypass-live-${token}`
const manifestId = `manifest-antibypass-${token}`
const verGood = `ver-good-${token}`
const verOther = `ver-other-${token}`

async function rest(method: string, path: string, body?: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`${BASE}/rest/v1/${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) })
  return { status: res.status, text: await res.text() }
}
async function rpc(body: unknown): Promise<{ status: number; text: string }> {
  return rest('POST', 'rpc/promote_copilot_version', body)
}

beforeAll(async () => {
  if (!LIVE) return
  const now = new Date().toISOString()
  // A copilot with a manifest (certified count_words tool) + two draft versions.
  await rest('POST', 'copilots', {
    id: copilotId, project_id: null, target_project_ids: [], name: `ANTIBYPASS-LIVE ${token}`, slug: `antibypass-live-${token}`,
    description: 'live anti-bypass test', runtime: 'langgraph', status: 'draft', production_version_id: null, latest_version_id: verGood,
    model: 'gpt-5.4', model_provider: 'openai', owner: 'test', tags: ['test'], created_at: now, updated_at: now,
    health: { testPassRate: 0, benchmarkScore: 0, runsLast24h: 0, errorRateLast24h: 0, avgLatencyMs: 0, costLast24hUsd: 0 }, created_via: 'authoring',
  })
  const toolId = `tool-cw-${token}`
  await rest('POST', 'manifests', {
    id: manifestId, copilot_id: copilotId, version: 'v0.1.0-draft', system_prompt_summary: 'count words', allowed_routes: [], forbidden_actions: [],
    confirmation_policy: 'never', always_confirm_actions: [], memory_sources: [], output_contract: { format: 'json', schemaName: null, invariants: [] },
    skills: [], tool_ids: [toolId], max_steps_per_run: 4, max_cost_per_run_usd: 0.5, updated_at: now,
  })
  await rest('POST', 'tools', { id: toolId, copilot_id: copilotId, name: 'count_words', description: 'count', provider: 'internal', risk_level: 'low', enabled: true, requires_confirmation: false, scoped_routes: [], mutates: false })
  for (const id of [verGood, verOther]) {
    await rest('POST', 'copilot_versions', {
      id, copilot_id: copilotId, label: 'v0.1.0-draft', stage: 'draft', manifest_id: manifestId, model: 'gpt-5.4', model_provider: 'openai',
      changelog: 'test', created_at: now, created_by: 'test', scores: { testPassRate: 0, benchmarkScore: 0, shadowAgreement: null, unsafeActionCount: null },
    })
  }
}, 40_000)

afterAll(async () => {
  if (!LIVE) return
  await rest('DELETE', `promotion_gates?copilot_id=eq.${copilotId}`)
  await rest('DELETE', `copilots?id=eq.${copilotId}`) // cascades manifests/tools/versions
}, 40_000)

/** Persist a fresh ready+PASS gate row for a version (what the RPC re-reads). */
async function persistFreshPassGate(versionId: string) {
  await rest('POST', 'promotion_gates', {
    id: `gate-${versionId}-${Math.random().toString(36).slice(2, 8)}`, copilot_id: copilotId, candidate_version_id: versionId,
    target_stage: 'production', checks: [], overall_status: 'ready', gate_result: 'PASS', registry_hash: 'test', evidence_hash: 'test',
    last_evaluated_at: new Date().toISOString(),
  })
}

describe('live anti-bypass — DB refuses what the route would refuse (PR #19 review)', () => {
  it('#3: only the 5-arg promote_copilot_version overload exists (3-arg dropped)', async () => {
    if (!LIVE) return console.warn('[live] skip: gpu1 not configured')
    // A 3-key body now resolves cleanly to the 5-arg (defaults) — no PGRST203
    // ambiguity, and it hits the gate check (ownership error on bogus ids proves
    // the hardened body ran, not the old ungated one).
    const r = await rpc({ p_copilot_id: '__nope__', p_version_id: '__nope__', p_previous_prod: null })
    expect(r.status).toBe(400)
    expect(r.text).toMatch(/does not belong to copilot/)
  })

  it('#5: a forward promotion with NO fresh passing gate is REFUSED at the DB', async () => {
    if (!LIVE) return console.warn('[live] skip')
    // No promotion_gates row for verGood yet → the RPC must raise.
    const r = await rpc({ p_copilot_id: copilotId, p_version_id: verGood, p_previous_prod: null, p_is_rollback: false })
    expect(r.status).toBe(400)
    expect(r.text).toMatch(/no gate evaluation|not a fresh PASS/)
    // The version must still be draft (nothing promoted).
    const v = await rest('GET', `copilot_versions?id=eq.${verGood}&select=stage`)
    expect(v.text).toContain('draft')
  })

  it('#4: a rollback of a NON-archived (draft) version is REFUSED at the DB', async () => {
    if (!LIVE) return console.warn('[live] skip')
    // p_is_rollback=true skips the fresh-gate check, but the DB now enforces the
    // archived-stage precondition itself (no longer only in the route).
    const r = await rpc({ p_copilot_id: copilotId, p_version_id: verGood, p_previous_prod: null, p_is_rollback: true })
    expect(r.status).toBe(400)
    expect(r.text).toMatch(/rollback refused|not an archived/)
  })

  it('official path: a forward promotion WITH a fresh passing gate succeeds → active/production', async () => {
    if (!LIVE) return console.warn('[live] skip')
    await persistFreshPassGate(verGood)
    const r = await rpc({ p_copilot_id: copilotId, p_version_id: verGood, p_previous_prod: null, p_is_rollback: false })
    expect(r.status).toBeLessThan(300)
    const c = await rest('GET', `copilots?id=eq.${copilotId}&select=status,production_version_id`)
    expect(c.text).toContain('active')
    expect(c.text).toContain(verGood)
  })

  it('12) two CONCURRENT promotions of different candidates never yield two production versions', async () => {
    if (!LIVE) return console.warn('[live] skip')
    // verGood is already production from the previous test. Persist a fresh gate
    // for verOther and fire two concurrent promotes of verOther — the single-
    // production partial-unique index (0027) lets at most one land; a loser 409s
    // (23505) or the pointer stays consistent. Assert exactly one production row.
    await persistFreshPassGate(verOther)
    await Promise.allSettled([
      rpc({ p_copilot_id: copilotId, p_version_id: verOther, p_previous_prod: verGood, p_is_rollback: false }),
      rpc({ p_copilot_id: copilotId, p_version_id: verOther, p_previous_prod: verGood, p_is_rollback: false }),
    ])
    const prod = await rest('GET', `copilot_versions?copilot_id=eq.${copilotId}&stage=eq.production&select=id`)
    const rows = JSON.parse(prod.text) as unknown[]
    expect(rows.length).toBe(1) // exactly one production version, never two
  })
})
