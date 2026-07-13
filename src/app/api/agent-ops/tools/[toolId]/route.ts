import { NextResponse } from 'next/server'

/**
 * Shape guard for `:toolId` path params. Real ids are `makeId('tool', slug)`
 * (see slug.ts): lowercase alphanumerics/hyphens only, bounded length. Mirrors
 * copilots/[copilotId]/route.ts's isValidCopilotId and projects/[id]/route.ts's
 * isValidProjectId. Rejects empty/oversized/garbage values before they reach a
 * live DB round-trip — a value that doesn't match this shape can never be a
 * real tool id, so a well-formed 400 here is strictly a fast, safe rejection
 * (no valid id is ever refused).
 */
const TOOL_ID_RE = /^[a-z0-9-]{1,200}$/

function isValidToolId(id: string): boolean {
  return typeof id === 'string' && TOOL_ID_RE.test(id)
}

/**
 * PATCH /api/agent-ops/tools/:toolId — persiste enabled / requiresConfirmation.
 * Écrit dans la base gpu1 via PostgREST (service_role, serveur uniquement).
 * Live-only : sans backend gpu1 configuré, on refuse (503) — jamais de faux succès.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params

  if (!isValidToolId(toolId)) {
    return NextResponse.json({ error: 'invalid toolId' }, { status: 400 })
  }

  let body: { enabled?: boolean; requiresConfirmation?: boolean }
  try {
    const parsed: unknown = await request.json()
    // `request.json()` accepts any valid JSON value (null, a number, a string,
    // an array, a boolean) — only a plain object is a valid patch body. A
    // non-object body would silently produce an empty patch below (both
    // `typeof body.enabled` checks fail safely on primitives), masking a
    // malformed request as a clean 400 "nothing to update" — mirrors
    // copilots/[copilotId]/route.ts's stricter body-shape guard.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })
    }
    body = parsed as { enabled?: boolean; requiresConfirmation?: boolean }
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
