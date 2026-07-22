import { NextResponse } from 'next/server'

import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'
import { evaluateReleaseGate } from '@/lib/agent-mission-control/release-gate'

/**
 * Shape guard for ids used by this route (`:copilotId` path param and the
 * `versionId` / `previousProductionVersionId` body fields). Real ids are
 * `makeId(prefix, slug)` (see slug.ts): lowercase alphanumerics/hyphens only,
 * bounded length — same shape family enforced by the sibling
 * `[copilotId]/route.ts`. Rejecting anything else before it reaches a live DB
 * round-trip does two things: (1) fast, safe 400 on garbage/oversized input —
 * no valid id is ever refused; (2) closes a PostgREST `in.(...)` list-filter
 * hazard, since that filter splits its value on literal commas — an id
 * containing a comma (or other filter-syntax character) could otherwise be
 * misparsed into extra/different id tokens for the ownership check below.
 */
const ID_RE = /^[a-z0-9-]{1,200}$/

function isValidId(id: string): boolean {
  return typeof id === 'string' && ID_RE.test(id)
}

/**
 * POST /api/agent-ops/copilots/:copilotId/promotion — promote a candidate to
 * production, or roll production back to a previous version. Writes gpu1 via
 * PostgREST (service_role, server only). Live-only: 503 without a backend.
 *
 * Body: { action: 'promote' | 'rollback', versionId, previousProductionVersionId? }
 *  - versionId                    → the version that becomes production.
 *  - previousProductionVersionId  → the version currently serving production
 *                                   (archived by the transition), if any.
 *
 * Transition (both actions share it):
 *   copilot_versions[versionId].stage         = 'production'
 *   copilot_versions[previousProd].stage       = 'archived'   (if provided, ≠ versionId)
 *   copilots[copilotId].production_version_id  = versionId
 *   copilots[copilotId].status                 = 'active'      (same PATCH — see below)
 *
 * Status alignment: a copilot serving a production version is `active` in the
 * stored model (the `CopilotStatus` enum has no `production` member — that's a
 * DISPLAY-only value derived by data.ts). The pointer and the status are set in
 * ONE `copilots` PATCH so they can never diverge into a half-written state where
 * production_version_id is set but status still reads draft. This is the
 * business-data fix that pairs with the displayStatus resolver; displayStatus
 * stays as the UI safety net for any pre-existing/inconsistent rows.
 *
 * Concurrency: the archive-previous step is conditioned on `stage=eq.production`
 * at patch time (optimistic concurrency), so two overlapping promotions can't
 * stomp on a version that a concurrent call already moved elsewhere — the
 * later request simply archives nothing for that id instead of clobbering
 * whatever stage it ended up in.
 */
export async function POST(request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params

  if (!isValidId(copilotId)) {
    return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })
  }

  let body: { action?: string; versionId?: string; previousProductionVersionId?: string | null }
  try {
    const parsed: unknown = await request.json()
    // `request.json()` accepts any valid JSON value (null, a number, a string,
    // an array, a boolean) — only a plain object is a valid body here. `null`
    // in particular would throw a TypeError on the `body.action` read below
    // (raw 500), so reject early with a clean 400 — same guard as the sibling
    // `[copilotId]/route.ts` PATCH.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })
    }
    body = parsed as { action?: string; versionId?: string; previousProductionVersionId?: string | null }
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (body.action !== 'promote' && body.action !== 'rollback') {
    return NextResponse.json({ error: "action must be 'promote' or 'rollback'" }, { status: 400 })
  }
  if (typeof body.versionId !== 'string' || !isValidId(body.versionId)) {
    return NextResponse.json({ error: 'versionId is required' }, { status: 400 })
  }
  if (
    body.previousProductionVersionId !== undefined &&
    body.previousProductionVersionId !== null &&
    (typeof body.previousProductionVersionId !== 'string' || !isValidId(body.previousProductionVersionId))
  ) {
    return NextResponse.json({ error: 'previousProductionVersionId must be a valid version id or null' }, { status: 400 })
  }
  const versionId = body.versionId
  const previousProd =
    typeof body.previousProductionVersionId === 'string' ? body.previousProductionVersionId : null

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  // --- Server-side release gate (fail-closed) ---
  // A PROMOTE to production re-evaluates the controlled release gate from live
  // data HERE, before any write — the UI enabling the button is a courtesy, not
  // the control. If any check is fail/missing, refuse with 422 and the blocking
  // reasons. Rollback is exempt (it restores a previously-shipped version, which
  // by definition already passed a gate) and beta promotion is exempt (the gate
  // guards production only).
  if (body.action === 'promote') {
    try {
      const gate = await evaluateReleaseGate(copilotId, versionId)
      if (!gate) {
        return NextResponse.json({ error: 'copilot or candidate version not found' }, { status: 404 })
      }
      if (!gate.promotable) {
        const blocking = gate.checks.filter((c) => c.status !== 'pass').map((c) => `${c.label}: ${c.observed}`)
        return NextResponse.json(
          { error: 'release gate not green — promotion blocked', blocking },
          { status: 422 }
        )
      }
    } catch (err) {
      console.error('[promotion] release gate evaluation failed', err instanceof Error ? err.message : err)
      // pgrest() timeout (PgrestError 504, postgrest.ts) → 504 gateway timeout;
      // any other upstream failure stays a generic 502. Same body either way.
      return NextResponse.json({ error: 'release gate evaluation failed' }, { status: isPgrestTimeout(err) ? 504 : 502 })
    }
  }

  async function pgrestGet(pathAndQuery: string): Promise<Record<string, unknown>[]> {
    const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      console.error(`PostgREST ${res.status} on ${pathAndQuery}: ${(await res.text()).slice(0, 500)}`)
      throw new Error('PostgREST error')
    }
    return (await res.json()) as Record<string, unknown>[]
  }

  async function patch(pathAndQuery: string, patchBody: Record<string, unknown>) {
    const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(patchBody),
    })
    // Never surface the raw PostgREST body to the caller — it can carry
    // internal schema/query detail. Log server-side only, respond generically.
    if (!res.ok) {
      console.error(`PostgREST ${res.status} on ${pathAndQuery}: ${(await res.text()).slice(0, 500)}`)
      throw new Error('PostgREST error')
    }
    return (await res.json()) as unknown[]
  }

  try {
    // 0) Load the copilot's ACTUAL current production_version_id from the DB
    // rather than trusting the client-supplied previousProductionVersionId
    // alone — the client derives that value from a page render that can be
    // stale (another promotion/rollback landed since). If the client's value
    // were the only source of truth and it disagreed with reality, step 2
    // below would archive the wrong row (or none), leaving TWO
    // `copilot_versions` rows at stage='production' for the same copilot —
    // an in-DB state that lies about what's actually serving. The real
    // pointer on `copilots.production_version_id` is the source of truth;
    // the body value is only used as an extra ownership/id check below.
    const copilotRows = await pgrestGet(
      `copilots?id=eq.${encodeURIComponent(copilotId)}&select=id,production_version_id`
    )
    if (copilotRows.length === 0) {
      return NextResponse.json({ error: 'copilot not found' }, { status: 404 })
    }
    const actualPreviousProd = (copilotRows[0].production_version_id as string | null) ?? null

    // Confirm versionId (and previousProd, if given) actually belong to this
    // copilot before mutating anything — otherwise a caller could pass a
    // versionId from a different copilot and promote/archive it (IDOR).
    const idsToVerify = Array.from(
      new Set([versionId, ...(previousProd ? [previousProd] : []), ...(actualPreviousProd ? [actualPreviousProd] : [])])
    )
    const ownedVersions = await pgrestGet(
      `copilot_versions?id=in.(${idsToVerify.map((id) => encodeURIComponent(id)).join(',')})&select=id,copilot_id,stage`
    )
    const ownedRows = ownedVersions.filter((row) => row.copilot_id === copilotId)
    const ownedIds = new Set(ownedRows.map((row) => row.id as string))
    const stageById = new Map(ownedRows.map((row) => [row.id as string, row.stage as string]))
    if (!ownedIds.has(versionId)) {
      return NextResponse.json({ error: 'version not found' }, { status: 404 })
    }
    if (previousProd && previousProd !== versionId && !ownedIds.has(previousProd)) {
      return NextResponse.json({ error: 'version not found' }, { status: 404 })
    }

    // --- Rollback invariant (fail-closed) ---
    // Promote runs the full release gate above; rollback is exempt ONLY because
    // it restores a version that already served production and thus already
    // passed the gate once. That exemption is sound only if the target really
    // is a previously-served version — proven by stage='archived' (the stage a
    // promotion transition leaves on the outgoing production version). Without
    // this check, `{action:'rollback', versionId:<any owned draft>}` would push
    // an un-gated draft straight to production+active, bypassing the gate
    // entirely. This mirrors the release UI, which only ever offers an
    // `archived` version as the rollback target.
    if (body.action === 'rollback' && stageById.get(versionId) !== 'archived') {
      return NextResponse.json(
        {
          error: 'rollback target must be a previously-served (archived) version',
          observedStage: stageById.get(versionId) ?? 'unknown',
        },
        { status: 409 }
      )
    }
    // The DB-derived pointer wins over the body value whenever it names a
    // real, owned version — this is what actually gets archived below.
    // Falls back to the client-supplied previousProd only if the DB pointer
    // is null/unowned (e.g. a stale/deleted id), so a legitimate call is
    // never blocked by this hardening.
    const previousProdToArchive =
      actualPreviousProd && ownedIds.has(actualPreviousProd) ? actualPreviousProd : previousProd

    // 1) The incoming version becomes production.
    const promoted = await patch(`copilot_versions?id=eq.${encodeURIComponent(versionId)}`, { stage: 'production' })
    if (promoted.length === 0) {
      return NextResponse.json({ error: 'version not found' }, { status: 404 })
    }
    // 2) Archive the version that was serving production (if distinct).
    // Conditioned on it still being `production` at patch time: if a
    // concurrent promotion already moved this version elsewhere (or archived
    // it), this call matches zero rows and no-ops instead of clobbering
    // whatever stage the other request left it in.
    if (previousProdToArchive && previousProdToArchive !== versionId) {
      await patch(
        `copilot_versions?id=eq.${encodeURIComponent(previousProdToArchive)}&stage=eq.production`,
        { stage: 'archived' }
      )
    }
    // 3) Point the copilot at the new production version AND align its stored
    // status to 'active' in the SAME PATCH. Both promote and rollback land a
    // version at stage='production', so both mean "serving production" → status
    // 'active', never 'draft'. Rollback therefore can't leave a copilot reading
    // draft while a production version exists. One write = pointer and status
    // stay consistent (no partial state).
    const copilot = await patch(`copilots?id=eq.${encodeURIComponent(copilotId)}`, {
      production_version_id: versionId,
      status: 'active',
    })
    if (copilot.length === 0) {
      return NextResponse.json({ error: 'copilot not found' }, { status: 404 })
    }
  } catch (err) {
    console.error('promotion failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'PostgREST error' }, { status: 502 })
  }

  return NextResponse.json({ ok: true, persisted: true, action: body.action, productionVersionId: versionId })
}
