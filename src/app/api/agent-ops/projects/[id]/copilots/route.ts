import { NextResponse } from 'next/server'

import { getCopilots, getManifestForCopilot, getToolsForCopilot } from '@/lib/agent-mission-control/data'
import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'
import { isValidProjectId } from '@/lib/agent-mission-control/resource-ids'
import type { AgentManifest, Copilot, CopilotStatus } from '@/lib/agent-mission-control/types'

/**
 * The external COPILOT status contract exposed to a partner consumer:
 * exactly `draft | available | suspended | archived`. This is deliberately
 * NARROWER and more honest than the raw DB enum
 * (`active | paused | draft | degraded | archived`) — a partner platform must
 * never see internal operational nuance (`degraded`) or be told a copilot is
 * "active" using a word that implies runnable-availability when the DB word
 * "active" is an admin lifecycle state.
 */
export type ExternalCopilotStatus = 'draft' | 'available' | 'suspended' | 'archived'

/**
 * The external RUN status contract (documented here for the partner consumer,
 * NOT emitted by this route — this route lists copilots, it does not run them):
 *   `queued | running | succeeded | failed | cancelled`.
 *
 * The run route (`POST /api/agent-ops/copilots/:copilotId/run`) today returns
 * Aigent's INTERNAL `AgentRunStatus` (`completed | failed | blocked |
 * needs-confirmation | running`) because its live in-repo consumer — the admin
 * `run-copilot-panel.tsx` → `RunStatusText` — is typed against that internal
 * union and would break if the field were re-labelled. Aigent's run is
 * synchronous, so in practice only `completed`/`failed` (and a paused
 * `needs-confirmation`) are reachable; `queued`/`cancelled` never occur.
 *
 * A partner consumer (TradeAgent) is therefore responsible for mapping the run
 * route's internal status to this external contract, honestly:
 *   completed          -> succeeded
 *   failed             -> failed
 *   blocked            -> failed      (a guardrail refused it — not a success)
 *   needs-confirmation -> running     (paused awaiting human approval, not done)
 *   running            -> running
 * The internal string is never leaked as-is into a partner's own status field.
 */

/**
 * Map the raw DB copilot status onto the external contract, HONESTLY.
 *
 * Pure function (no I/O) so it is trivially unit-testable and carries the whole
 * mapping decision in one place:
 *   - `draft`    -> `draft`      NEVER auto-promoted to `available`. A draft is
 *                                unvalidated; presenting it as available would
 *                                be a lie to the partner.
 *   - `active`   -> `available`  the copilot is live and offered.
 *   - `paused`   -> `suspended`  intentionally taken out of service.
 *   - `degraded` -> `suspended`  a degraded copilot is misbehaving; it must NOT
 *                                be presented as `available`. `suspended` is the
 *                                most honest external word: "not offered right
 *                                now", without leaking the internal reason.
 *   - `archived` -> `archived`   end-of-life.
 *
 * The union is exhaustive over `CopilotStatus`; a future DB status added
 * without a mapping here fails to typecheck rather than silently defaulting to
 * a friendlier value.
 */
export function mapCopilotStatus(status: CopilotStatus): ExternalCopilotStatus {
  switch (status) {
    case 'draft':
      return 'draft'
    case 'active':
      return 'available'
    case 'paused':
      return 'suspended'
    case 'degraded':
      return 'suspended'
    case 'archived':
      return 'archived'
  }
}

/**
 * Verbs in a manifest's `forbiddenActions` that denote a WRITE / mutation. Used
 * only as corroborating evidence for `readOnly` — the primary signal is the
 * explicit `read-only` invariant (see `deriveReadOnly`).
 */
const WRITE_VERB_RE = /\b(place|modify|execute|write|submit|cancel|delete|update|create|send|transfer|withdraw)\b/i

/**
 * Derive `readOnly: boolean | null` for a copilot from its manifest, grounded
 * in what the real TradeAgent manifests ACTUALLY contain (verified live):
 *
 *   outputContract.invariants: ["read-only", "never fabricates unavailable metrics"]
 *   forbiddenActions:          ["execute withdrawals", "place orders",
 *                               "write to external systems"]
 *
 * Signal, in order of authority:
 *   1. An explicit `read-only` invariant in `outputContract.invariants` — the
 *      copilot AUTHOR asserting the contract is read-only. This is the honest,
 *      first-class signal (the previous `forbiddenActions.length > 0` heuristic
 *      was WRONG: a non-empty forbidden list means "has restrictions", which is
 *      true of almost every agent, not "read-only").
 *   2. Corroboration: `forbiddenActions` forbids every write-like verb we can
 *      see (place/modify/execute/write/…). This lets a manifest that omitted
 *      the invariant string but hard-forbids all mutations still read as
 *      read-only — but only when there IS at least one such forbidden action,
 *      never from an empty list (an empty forbidden list is not a read-only
 *      claim).
 *
 * No manifest at all → `null` (unknown), NEVER a guessed default. `false` is
 * returned only when a manifest exists and neither honest signal holds — i.e.
 * we have a manifest and it does not claim read-only.
 */
export function deriveReadOnly(manifest: AgentManifest | undefined): boolean | null {
  if (!manifest) return null

  const invariants = manifest.outputContract?.invariants ?? []
  const hasReadOnlyInvariant = invariants.some((inv) => /read[\s-]?only/i.test(inv))
  if (hasReadOnlyInvariant) return true

  const forbidden = manifest.forbiddenActions ?? []
  if (forbidden.length > 0 && forbidden.every((action) => WRITE_VERB_RE.test(action))) {
    return true
  }

  return false
}

/**
 * GET /api/agent-ops/projects/:id/copilots — the real, authorized catalog of
 * copilots assigned to a project. This is the read surface an external
 * consumer (e.g. a partner platform) is meant to call to list the copilots it
 * is allowed to see — scoped strictly by `project_id`, never a global dump.
 *
 * Reuses `getCopilots`/`getManifestForCopilot`/`getToolsForCopilot` (the same
 * live PostgREST reads the admin dashboard already uses) instead of adding a
 * second data path. Live-only, fail-closed: no backend configured → 503, a
 * project with zero assigned copilots → `{ copilots: [] }` (not an error).
 *
 * Auth: gated by the existing `/api/agent-ops/**` boundary in `proxy.ts`
 * (admin session OR `x-amc-key`) — no new auth mechanism introduced here.
 *
 * NEVER exposed in this payload: system prompt internals, secrets/API keys,
 * private traces, another tenant's data, or chain-of-thought. Only the
 * author-facing contract surface (skills labels, tool names, output contract,
 * cost policy) leaves this route.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params

  if (!isValidProjectId(projectId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  if (
    process.env.AMC_DATA_SOURCE !== 'gpu1' ||
    !process.env.AMC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  let copilots: Copilot[]
  try {
    copilots = (await getCopilots({ health: 'list' })).filter((c) => c.projectId === projectId)
  } catch (err) {
    console.error('[GET /api/agent-ops/projects/:id/copilots] failed to load copilots', err)
    return NextResponse.json({ error: 'failed to load copilots' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }

  try {
    const entries = await Promise.all(
      copilots.map(async (copilot) => {
        const [manifest, tools] = await Promise.all([
          getManifestForCopilot(copilot.id),
          getToolsForCopilot(copilot.id),
        ])
        const status = mapCopilotStatus(copilot.status)
        return {
          id: copilot.id,
          name: copilot.name,
          description: copilot.description,
          projectId: copilot.projectId,
          projectName: null as string | null,
          version: manifest?.version ?? null,
          // The EXTERNAL contract status: draft | available | suspended |
          // archived (mapCopilotStatus). `draft` is NEVER promoted to
          // `available`. The raw DB enum value is kept alongside as
          // `rawStatus` for debugging/support, but the contract field callers
          // switch on is `status`.
          status,
          rawStatus: copilot.status,
          provider: copilot.modelProvider,
          model: copilot.model,
          capabilities: manifest?.skills.map((s) => s.label) ?? [],
          tools: tools.filter((t) => t.enabled).map((t) => t.name),
          inputSchema: null as unknown,
          outputSchema: manifest?.outputContract ?? null,
          requiresHumanApproval: manifest ? manifest.confirmationPolicy !== 'never' : null,
          // Grounded in the manifest's explicit `read-only` invariant (with a
          // forbidden-write-verb corroboration), NOT the old wrong heuristic
          // `forbiddenActions.length > 0`. No manifest → null, never guessed.
          readOnly: deriveReadOnly(manifest),
          createdAt: copilot.createdAt,
          updatedAt: copilot.updatedAt,
          lastRunAt: copilot.health?.runsLast24h ? copilot.updatedAt : null,
          successRate:
            copilot.health && copilot.health.runsLast24h > 0
              ? 1 - copilot.health.errorRateLast24h
              : null,
          costPolicy: manifest ? { maxCostPerRunUsd: manifest.maxCostPerRunUsd } : {},
          // Only a mapped-`available` copilot is offered as runnable to an
          // external caller; everything else (draft/suspended/archived) is
          // present in the catalog but not available. Derived from the mapped
          // status so it stays consistent with the contract above.
          availability: status === 'available' ? 'available' : 'unavailable',
        }
      })
    )
    return NextResponse.json({ ok: true, projectId, copilots: entries })
  } catch (err) {
    console.error('[GET /api/agent-ops/projects/:id/copilots] failed to load manifest/tools', err)
    return NextResponse.json({ error: 'failed to load copilot detail' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
}
