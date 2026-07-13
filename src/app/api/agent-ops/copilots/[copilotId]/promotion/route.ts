import { NextResponse } from 'next/server'

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
 */
export async function POST(request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params

  let body: { action?: string; versionId?: string; previousProductionVersionId?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (body.action !== 'promote' && body.action !== 'rollback') {
    return NextResponse.json({ error: "action must be 'promote' or 'rollback'" }, { status: 400 })
  }
  if (typeof body.versionId !== 'string' || body.versionId.length === 0) {
    return NextResponse.json({ error: 'versionId is required' }, { status: 400 })
  }
  const versionId = body.versionId
  const previousProd =
    typeof body.previousProductionVersionId === 'string' ? body.previousProductionVersionId : null

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
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
    // 0) Confirm versionId (and previousProd, if given) actually belong to
    // this copilot before mutating anything — otherwise a caller could pass
    // a versionId from a different copilot and promote/archive it (IDOR).
    const idsToVerify = [versionId, ...(previousProd ? [previousProd] : [])]
    const ownedVersions = await pgrestGet(
      `copilot_versions?id=in.(${idsToVerify.map((id) => encodeURIComponent(id)).join(',')})&select=id,copilot_id`
    )
    const ownedIds = new Set(
      ownedVersions.filter((row) => row.copilot_id === copilotId).map((row) => row.id as string)
    )
    if (!ownedIds.has(versionId)) {
      return NextResponse.json({ error: 'version not found' }, { status: 404 })
    }
    if (previousProd && previousProd !== versionId && !ownedIds.has(previousProd)) {
      return NextResponse.json({ error: 'version not found' }, { status: 404 })
    }

    // 1) The incoming version becomes production.
    const promoted = await patch(`copilot_versions?id=eq.${encodeURIComponent(versionId)}`, { stage: 'production' })
    if (promoted.length === 0) {
      return NextResponse.json({ error: 'version not found' }, { status: 404 })
    }
    // 2) Archive the version that was serving production (if distinct).
    if (previousProd && previousProd !== versionId) {
      await patch(`copilot_versions?id=eq.${encodeURIComponent(previousProd)}`, { stage: 'archived' })
    }
    // 3) Point the copilot at the new production version.
    const copilot = await patch(`copilots?id=eq.${encodeURIComponent(copilotId)}`, {
      production_version_id: versionId,
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
