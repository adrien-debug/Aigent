/**
 * Non-regression guards for the DB-layer promotion anti-bypass holes found in
 * the PR #19 review and closed by migrations 0030 + 0031. These defects live in
 * SQL (the promote_copilot_version RPC + grants), so the durable in-repo guard
 * is to pin the invariants of the SHIPPED migration text — a future migration
 * that reopens a hole fails here. The behaviour itself is additionally proven
 * LIVE against gpu1 via `npm run test:live` (the DB is not reachable from CI,
 * so a text contract is the CI-runnable regression).
 *
 * Confirmed-live findings this pins:
 *  #2  the 5-arg overload must be GRANTed EXECUTE to service_role (0030).
 *  #1  replay_comparisons must carry candidate_version_id (0030).
 *  #3  the ungated 3-arg overload must be DROPPED (0031).
 *  #4  the rollback path must enforce the archived-stage precondition IN the RPC.
 *  #5/#7 the forward guard must use the LATEST evaluation, not count(*)>0.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const sql0030 = readFileSync(join(MIGRATIONS, '0030_promotion_rpc_grant_and_replay_candidate.sql'), 'utf8')
const sql0031 = readFileSync(join(MIGRATIONS, '0031_promotion_rpc_harden_antibypass.sql'), 'utf8')

/** Strip SQL line comments so we assert on executable statements, not prose. */
function executable(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .toLowerCase()
}

const exec0030 = executable(sql0030)
const exec0031 = executable(sql0031)

describe('promotion RPC anti-bypass — DB migration invariants (PR #19 review fixes)', () => {
  it('#2: the 5-arg overload is granted EXECUTE to service_role (RPC callable, not 42501)', () => {
    expect(exec0030).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.promote_copilot_version\(text,\s*text,\s*text,\s*boolean,\s*integer\)\s+to\s+service_role/,
    )
  })

  it('#1: replay_comparisons gains candidate_version_id (evidence↔candidate link)', () => {
    expect(exec0030).toMatch(/alter\s+table\s+replay_comparisons\s+add\s+column\s+if\s+not\s+exists\s+candidate_version_id/)
  })

  it('#3: the ungated 3-arg overload is dropped (no residual gate-free promotion path)', () => {
    expect(exec0031).toMatch(/drop\s+function\s+if\s+exists\s+promote_copilot_version\(text,\s*text,\s*text\)\s*;/)
  })

  it('#4: the rollback path enforces the archived-stage precondition inside the RPC', () => {
    // The hardened body must, on rollback, refuse a target whose stage is not
    // 'archived' — the guard can no longer live only in the TS route.
    expect(exec0031).toContain("v_candidate_stage is distinct from 'archived'")
    expect(exec0031).toMatch(/rollback refused/)
  })

  it('#5/#7: the forward guard uses the LATEST evaluation (order by desc limit 1), not count(*)>0', () => {
    // A newer 'blocked' evaluation must win over an earlier fresh PASS.
    expect(exec0031).toMatch(/order\s+by\s+last_evaluated_at\s+desc\s*\n?\s*limit\s+1/)
    expect(exec0031).toContain("v_latest_status is distinct from 'ready'")
    expect(exec0031).toContain("v_latest_result is distinct from 'pass'")
    // The old count(*)-based EXISTS check must be gone from the shipped body.
    expect(exec0031).not.toMatch(/select\s+count\(\*\)\s+into\s+v_fresh_ready_count/)
  })

  it('#3: exactly one promote_copilot_version signature survives in the shipped migrations (the 5-arg)', () => {
    // 0031 drops the 3-arg and (re)creates only the 5-arg. No create of a 3-arg.
    expect(exec0031).not.toMatch(/create\s+or\s+replace\s+function\s+promote_copilot_version\(\s*p_copilot_id\s+text,\s*p_version_id\s+text,\s*p_previous_prod\s+text\s*\)/)
  })
})
