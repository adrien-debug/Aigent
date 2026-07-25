/**
 * Non-regression guards for migration 0033 — the privilege-separation fix that
 * replaces 0032's FORGEABLE session GUC with a real DB boundary. The fix lives in
 * SQL (roles, grants, ownership, a SECURITY INVOKER trigger), so the CI-runnable
 * regression pins the shipped migration's invariants; runtime behaviour is proven
 * LIVE in tests/live/promotion-privilege-separation.live.test.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '0033_promotion_privilege_separation.sql'), 'utf8')
const exec = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n').toLowerCase()

describe('migration 0033 — privilege separation replaces the forgeable GUC', () => {
  it('creates a protected NOLOGIN NOINHERIT NOBYPASSRLS executor role', () => {
    expect(exec).toMatch(/create role aigent_promotion_executor nologin noinherit nobypassrls/)
  })

  it('the guard NO LONGER trusts a session GUC — the marker check is gone', () => {
    // The whole point: current_setting('app.promotion') must not be the authority.
    expect(exec).not.toMatch(/current_setting\('app\.promotion'/)
    expect(exec).not.toMatch(/set_config\('app\.promotion'/)
  })

  it('the guard authorizes ONLY the executor via current_user (real effective role)', () => {
    expect(exec).toMatch(/if current_user = 'aigent_promotion_executor' then\s*\n\s*return new/)
  })

  it('the guard trigger function is NOT security definer (must observe the invoker)', () => {
    // Extract the enforce_promotion_via_rpc function body region and assert it has
    // no `security definer` (which would make current_user the owner, not caller).
    const fnStart = exec.indexOf('function enforce_promotion_via_rpc')
    const fnEnd = exec.indexOf('$$;', fnStart)
    const body = exec.slice(fnStart, fnEnd)
    expect(body).not.toContain('security definer')
  })

  it('service_role loses column UPDATE on the critical transition columns', () => {
    expect(exec).toMatch(/revoke update on copilots from service_role/)
    expect(exec).toMatch(/revoke update on copilot_versions from service_role/)
    // and is re-granted the benign columns (not status / production_version_id / stage).
    // Isolate the service_role re-grant specifically (there is also an executor
    // grant that legitimately names the critical columns).
    const end = exec.indexOf(') on copilots to service_role')
    const start = exec.lastIndexOf('grant update (', end)
    const copRegrant = exec.slice(start, end)
    expect(copRegrant).not.toMatch(/\bstatus\b/)
    expect(copRegrant).not.toMatch(/production_version_id/)
    expect(copRegrant).toMatch(/updated_at/)
  })

  it('the RPC is owned by the executor and is SECURITY DEFINER', () => {
    expect(exec).toMatch(/alter function promote_copilot_version\(text, text, text, boolean, integer\)\s*\n?\s*owner to aigent_promotion_executor/)
    const rpcStart = exec.indexOf('create or replace function promote_copilot_version')
    const rpcBody = exec.slice(rpcStart, exec.indexOf('$$;', rpcStart))
    expect(rpcBody).toContain('security definer')
    expect(rpcBody).toMatch(/set search_path = pg_catalog, public/)
  })

  it('executor cannot CREATE in public (anti-shadowing of resolved objects)', () => {
    expect(exec).toMatch(/revoke create on schema public from aigent_promotion_executor/)
  })

  it('TTL semantics: NULL/0/negative is a HARD ERROR, >3600 clamps down', () => {
    expect(exec).toMatch(/p_max_evidence_age_seconds is null or p_max_evidence_age_seconds <= 0/)
    expect(exec).toMatch(/invalid p_max_evidence_age_seconds/)
    expect(exec).toMatch(/least\(p_max_evidence_age_seconds, c_max_ttl_seconds\)/)
    expect(exec).toMatch(/c_max_ttl_seconds constant integer := 3600/)
  })

  it('RLS policies scope the executor precisely (no widening for other roles)', () => {
    expect(exec).toMatch(/create policy promo_exec_update_copilots on copilots for update to aigent_promotion_executor/)
    expect(exec).toMatch(/create policy promo_exec_update_versions on copilot_versions for update to aigent_promotion_executor/)
  })
})
