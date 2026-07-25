/**
 * Agent Mission Control — promotion policy resolver (server only).
 *
 * AIGENT-FACTORY-SHADOW-REPLAY-001. Resolves the `PromotionPolicy`
 * (requireShadow/requireReplay, see promotion-gate.ts) a specific copilot must
 * satisfy, from the DB signal `copilots.requires_shadow_replay` (migration
 * 0035) — never from a created_at date heuristic, never hardcoded globally.
 *
 * THE COMPATIBILITY RULE (read this before changing anything here):
 *   - `requires_shadow_replay = true`  → strict policy: requireShadow=true,
 *     requireReplay=true. This is what every copilot created via
 *     createCopilotFromManifest gets from now on (authoring-writes.ts sets it
 *     explicitly at INSERT time — never left NULL for a new copilot).
 *   - `requires_shadow_replay = false` → explicit opt-out (not set
 *     automatically by anything today; reserved for a future, deliberate,
 *     human decision). Falls back to DEFAULT_PROMOTION_POLICY
 *     (requireShadow=false, requireReplay=false) — the historical lenient
 *     default, chosen ON PURPOSE for this row.
 *   - `requires_shadow_replay = NULL`  → a PRE-CUTOVER copilot: it existed
 *     before shadow/replay evidence was ever collectible, so retroactively
 *     requiring it would brick every already-promotable historical copilot
 *     with an obligation nobody could have satisfied. NULL therefore resolves
 *     to the lenient DEFAULT_PROMOTION_POLICY too — but UNLIKE the `false`
 *     case, this is logged (see `resolvePromotionPolicy`'s `source` field) so
 *     the distinction between "explicitly opted out" and "grandfathered in"
 *     is never lost in an audit trail.
 *   - The copilot ROW ITSELF is missing / unreadable (PostgREST error, id not
 *     found) → FAIL-CLOSED. "Undeterminable" means MORE strict, not less: the
 *     resolver returns the STRICT policy (requireShadow=true,
 *     requireReplay=true) and marks `source: 'undeterminable-fail-closed'`.
 *     A caller that cannot even confirm which policy a copilot has must never
 *     silently assume the lenient one — that would turn a transient DB hiccup
 *     into a promotion-gate bypass.
 *
 * This is the ONLY function that may decide requireShadow/requireReplay for a
 * real promotion; the API routes and evaluatePromotionGate() callers must go
 * through it rather than hardcoding DEFAULT_PROMOTION_POLICY.
 */
import 'server-only'

import { pgrest, PgrestError } from './postgrest'
import { DEFAULT_PROMOTION_POLICY, type PromotionPolicy } from './promotion-gate'

const STRICT_POLICY: PromotionPolicy = { requireShadow: true, requireReplay: true }

export type PromotionPolicySource =
  | 'strict-opt-in' // requires_shadow_replay = true
  | 'explicit-opt-out' // requires_shadow_replay = false
  | 'grandfathered-null' // requires_shadow_replay = null (pre-cutover row)
  | 'undeterminable-fail-closed' // copilot row missing/unreadable

export interface ResolvedPromotionPolicy {
  policy: PromotionPolicy
  source: PromotionPolicySource
}

/**
 * Resolve the promotion policy for `copilotId`, live. Never throws on a
 * missing/unreadable row — that case is the fail-closed branch, not an error
 * the caller must handle separately (a route that can't tell the policy still
 * needs an answer to evaluate the gate against).
 */
export async function resolvePromotionPolicy(copilotId: string): Promise<ResolvedPromotionPolicy> {
  let rows: Record<string, unknown>[]
  try {
    rows = await pgrest<Record<string, unknown>[]>(
      'GET',
      `copilots?id=eq.${encodeURIComponent(copilotId)}&select=requires_shadow_replay`
    )
  } catch (err) {
    // Fail-closed: an upstream error (including a PgrestError from a bad
    // filter) must not read as "no policy required". Log server-side for
    // observability, resolve strict.
    console.error('[promotion-policy] copilot policy read failed — resolving STRICT (fail-closed)', copilotId, err instanceof PgrestError ? err.detail : err)
    return { policy: STRICT_POLICY, source: 'undeterminable-fail-closed' }
  }
  if (rows.length === 0) {
    console.error('[promotion-policy] copilot not found — resolving STRICT (fail-closed)', copilotId)
    return { policy: STRICT_POLICY, source: 'undeterminable-fail-closed' }
  }
  const raw = rows[0].requires_shadow_replay
  if (raw === true) return { policy: STRICT_POLICY, source: 'strict-opt-in' }
  if (raw === false) return { policy: DEFAULT_PROMOTION_POLICY, source: 'explicit-opt-out' }
  return { policy: DEFAULT_PROMOTION_POLICY, source: 'grandfathered-null' }
}
