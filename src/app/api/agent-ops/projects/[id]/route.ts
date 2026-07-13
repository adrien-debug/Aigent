import { NextResponse } from 'next/server'

import { deleteProjectCascade } from '@/lib/agent-mission-control/authoring-writes'

/**
 * DELETE /api/agent-ops/projects/:id — supprime définitivement un projet et
 * cascade-delete tous ses copilotes (avec leurs versions/tests/runs/etc.), en
 * ordre FK-safe. Live-only, fail-closed. 404 si le projet n'existe pas, 502 si
 * la cascade échoue à mi-parcours.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !process.env.AMC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  try {
    const existed = await deleteProjectCascade(id)
    if (!existed) return NextResponse.json({ error: 'project not found' }, { status: 404 })
    return NextResponse.json({ ok: true, deleted: true })
  } catch (err) {
    // Log the full error server-side only — the underlying message can carry
    // PostgREST internals (table/query shape, raw response body), which must
    // never reach the client. The public contract stays a generic message.
    console.error('[agent-ops] DELETE /projects/:id cascade failed:', err)
    return NextResponse.json({ error: 'delete failed' }, { status: 502 })
  }
}
