/**
 * Non-regression guards for migration 0032 (74257ea review reworks). The fixes
 * live in SQL (a transition-guard trigger + a server-clamped TTL), so the durable
 * CI-runnable regression is to pin the shipped migration's invariants; the runtime
 * behaviour is proven LIVE in tests/live/promotion-direct-write-lockdown.live.test.ts.
 *
 * REWORK 2: a BEFORE-UPDATE trigger on copilots/copilot_versions refuses a
 *   transition INTO active/production unless the official RPC set the tx-local GUC.
 * REWORK 1: the RPC clamps p_max_evidence_age_seconds to a hard server maximum and
 *   fail-closes on a non-positive value — the caller can only shorten the window.
 * Plus: pinned search_path on both SECURITY DEFINER functions, deterministic
 * tie-break on the latest-evaluation read.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '0032_promotion_direct_write_lockdown.sql'), 'utf8')
const exec = sql
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n')
  .toLowerCase()

describe('migration 0032 — direct-write lockdown + server-authoritative TTL', () => {
  it('REWORK 2: a BEFORE UPDATE trigger guards both copilots and copilot_versions', () => {
    expect(exec).toMatch(/create trigger trg_copilots_promotion_guard[\s\S]*before update on copilots/)
    expect(exec).toMatch(/create trigger trg_versions_promotion_guard[\s\S]*before update on copilot_versions/)
  })

  it('REWORK 2: the guard refuses transitions INTO active / production', () => {
    expect(exec).toContain("new.status = 'active' and old.status is distinct from 'active'")
    expect(exec).toContain("new.stage = 'production' and old.stage is distinct from 'production'")
    // A direct repoint of the production pointer is also refused.
    expect(exec).toMatch(/new\.production_version_id is distinct from old\.production_version_id/)
    expect(exec).toMatch(/is forbidden/)
  })

  it('REWORK 2: only the RPC bypasses the guard, via a tx-local GUC it alone sets', () => {
    // The guard allows the write only when app.promotion='rpc'.
    expect(exec).toMatch(/current_setting\('app\.promotion', true\)/)
    // The RPC sets that GUC LOCAL to its own transaction (3rd arg true = local).
    expect(exec).toMatch(/set_config\('app\.promotion', 'rpc', true\)/)
  })

  it('REWORK 1: the TTL is clamped to a hard server maximum, non-positive fails closed', () => {
    expect(exec).toMatch(/c_max_ttl_seconds constant integer := 3600/)
    // A NULL/<=0 request → the max; anything larger → clamped down with least().
    expect(exec).toMatch(/p_max_evidence_age_seconds is null or p_max_evidence_age_seconds <= 0/)
    expect(exec).toMatch(/least\(p_max_evidence_age_seconds, c_max_ttl_seconds\)/)
    // The freshness comparison uses the clamped value, not the raw caller value.
    expect(exec).toMatch(/now\(\) - make_interval\(secs => v_ttl_seconds\)/)
    expect(exec).not.toMatch(/make_interval\(secs => p_max_evidence_age_seconds\)/)
  })

  it('complementary: both SECURITY DEFINER functions pin a safe search_path', () => {
    // Two occurrences: the trigger fn and the RPC.
    const matches = exec.match(/set search_path = pg_catalog, public/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })

  it('complementary: the latest-evaluation read has a deterministic tie-break (id)', () => {
    expect(exec).toMatch(/order by last_evaluated_at desc, id desc/)
  })

  it('freshness uses the DB clock now(), never a client-supplied date', () => {
    expect(exec).toContain('now() - make_interval')
    // No client timestamp is threaded into the comparison — only now() and the TTL.
    expect(exec).not.toMatch(/p_evaluated_at|p_now|client_time/)
  })
})
