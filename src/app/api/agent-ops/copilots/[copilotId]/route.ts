import { NextResponse } from 'next/server'

import { deleteCopilotCascade } from '@/lib/agent-mission-control/authoring-writes'
import { ensureCopilotAssistant } from '@/lib/agent-mission-control/langgraph-assistants'

/**
 * Shape guard for `:copilotId` path params. Real ids are `makeId('copilot', slug)`
 * (see slug.ts): lowercase alphanumerics/hyphens only, bounded length. Rejects
 * empty/oversized/garbage values before they reach a live DB round-trip — a
 * value that doesn't match this shape can never be a real copilot id, so a
 * well-formed 400 here is strictly a fast, safe rejection (no valid id is ever
 * refused).
 */
const COPILOT_ID_RE = /^[a-z0-9-]{1,200}$/

function isValidCopilotId(id: string): boolean {
  return typeof id === 'string' && COPILOT_ID_RE.test(id)
}

/**
 * DELETE /api/agent-ops/copilots/:copilotId — supprime définitivement un
 * copilote et toutes ses données (versions, manifests, tools, tests, runs,
 * benchmarks, traces), en cascade FK-safe. Live-only, fail-closed. 404 si le
 * copilote n'existe pas, 502 si la cascade échoue à mi-parcours.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params

  if (!isValidCopilotId(copilotId)) {
    return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })
  }

  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !process.env.AMC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  try {
    const existed = await deleteCopilotCascade(copilotId)
    if (!existed) return NextResponse.json({ error: 'copilot not found' }, { status: 404 })
    return NextResponse.json({ ok: true, deleted: true })
  } catch (err) {
    // Don't forward raw internal error detail (pgrest embeds PostgREST
    // response bodies / table & column names in its Error message) to the
    // client — log server-side for operators, return a generic message.
    console.error('[DELETE /api/agent-ops/copilots/:copilotId] cascade delete failed', err)
    return NextResponse.json({ error: 'delete failed' }, { status: 502 })
  }
}

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

  if (!isValidCopilotId(copilotId)) {
    return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })
  }

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

  // project_id changed (bench↔project attach) → the baked assistant config is
  // now stale (wrong/missing repo tools). Re-provision best-effort: the DB
  // write already succeeded and is the primary effect, so a re-provision
  // failure must not fail the whole PATCH — it's surfaced instead so the
  // operator knows the assistant may still be stale.
  if ('projectId' in body) {
    try {
      await ensureCopilotAssistant({ copilotId })
      // Re-provision succeeded — the caller gets a positive signal so a UI can
      // confirm the copilot now runs against a fresh, correctly-scoped assistant.
      return NextResponse.json({ ok: true, persisted: true, reprovisioned: true })
    } catch (err) {
      // The DB write already committed (primary effect) so we don't fail the
      // PATCH, but we surface reprovisioned:false so the operator knows the
      // baked assistant config may still be stale and can retry. The reason is
      // logged server-side only — err can carry internal service/PostgREST
      // detail that shouldn't be forwarded verbatim to the client.
      console.error('[PATCH /api/agent-ops/copilots/:copilotId] assistant re-provision failed', err)
      return NextResponse.json({
        ok: true,
        persisted: true,
        reprovisioned: false,
        reprovisionWarning: 'assistant re-provision failed',
      })
    }
  }

  return NextResponse.json({ ok: true, persisted: true })
}
