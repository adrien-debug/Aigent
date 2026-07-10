import { NextResponse } from 'next/server'

/**
 * PATCH /api/agent-ops/copilots/:copilotId — persiste l'affectation projet
 * (banc de validation) : `projectId` (null = retour sur le banc) et/ou
 * `targetProjectIds` (destinations de développement, 2 max).
 * Écrit dans la base gpu1 via PostgREST (service_role, serveur uniquement).
 * Live-only : sans backend gpu1 configuré, on refuse (503) — jamais de faux succès.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ copilotId: string }> }
) {
  const { copilotId } = await params

  let body: { projectId?: string | null; targetProjectIds?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  if ('projectId' in body) {
    if (body.projectId !== null && typeof body.projectId !== 'string') {
      return NextResponse.json({ error: 'projectId must be a string or null' }, { status: 400 })
    }
    patch.project_id = body.projectId
  }
  if ('targetProjectIds' in body) {
    const targets = body.targetProjectIds
    if (!Array.isArray(targets) || targets.some((id) => typeof id !== 'string')) {
      return NextResponse.json({ error: 'targetProjectIds must be an array of strings' }, { status: 400 })
    }
    if (targets.length > 2) {
      return NextResponse.json({ error: 'targetProjectIds: 2 destinations max' }, { status: 400 })
    }
    patch.target_project_ids = targets
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  const res = await fetch(`${base}/rest/v1/copilots?id=eq.${encodeURIComponent(copilotId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  })

  if (!res.ok) {
    return NextResponse.json({ error: `PostgREST ${res.status}` }, { status: 502 })
  }
  const rows = (await res.json()) as unknown[]
  if (rows.length === 0) {
    return NextResponse.json({ error: 'copilot not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, persisted: true })
}
