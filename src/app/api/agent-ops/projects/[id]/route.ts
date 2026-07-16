import { NextResponse } from 'next/server'

import { deleteProjectCascade } from '@/lib/agent-mission-control/authoring-writes'

/**
 * Shape guard for `:id` path params. Real ids are `makeId('proj', slug)` (see
 * slug.ts): lowercase alphanumerics/hyphens only, bounded length. Rejects
 * empty/oversized/garbage (e.g. unicode, huge strings) values before they
 * reach a live DB round-trip — mirrors copilots/[copilotId]/route.ts's
 * isValidCopilotId. A value that doesn't match this shape can never be a real
 * project id, so a well-formed 400 here is strictly a fast, safe rejection (no
 * valid id is ever refused).
 */
const PROJECT_ID_RE = /^[a-z0-9-]{1,200}$/

function isValidProjectId(id: string): boolean {
  return typeof id === 'string' && PROJECT_ID_RE.test(id)
}

/**
 * DELETE /api/agent-ops/projects/:id — supprime définitivement un projet et
 * cascade-delete tous ses copilotes (avec leurs versions/tests/runs/etc.), en
 * ordre FK-safe. Live-only, fail-closed. 404 si le projet n'existe pas, 502 si
 * la cascade échoue à mi-parcours.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  if (!isValidProjectId(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

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
    // pgrest() rethrows a hung round-trip as PgrestError(504) (postgrest.ts,
    // PGREST_TIMEOUT_MS) — surface it as a 504 so the client can tell "backend
    // too slow" from "backend rejected the delete". Duck-typed on name/status
    // because the class isn't exported; every other failure stays a 502.
    const timedOut =
      err instanceof Error && err.name === 'PgrestError' && (err as { status?: unknown }).status === 504
    if (timedOut) return NextResponse.json({ error: 'delete timed out' }, { status: 504 })
    return NextResponse.json({ error: 'delete failed' }, { status: 502 })
  }
}
