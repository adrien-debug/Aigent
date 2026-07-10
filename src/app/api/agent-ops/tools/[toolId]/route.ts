import { NextResponse } from 'next/server'

/**
 * PATCH /api/agent-ops/tools/:toolId — persiste enabled / requiresConfirmation.
 * Écrit dans la base gpu1 via PostgREST (service_role, serveur uniquement).
 * Live-only : sans backend gpu1 configuré, on refuse (503) — jamais de faux succès.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params

  let body: { enabled?: boolean; requiresConfirmation?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const patch: Record<string, boolean> = {}
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (typeof body.requiresConfirmation === 'boolean') patch.requires_confirmation = body.requiresConfirmation
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  const res = await fetch(`${base}/rest/v1/tools?id=eq.${encodeURIComponent(toolId)}`, {
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
    return NextResponse.json({ error: 'tool not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, persisted: true })
}
