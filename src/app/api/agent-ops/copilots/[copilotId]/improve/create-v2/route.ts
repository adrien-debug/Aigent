import { NextResponse } from 'next/server'

import { createImprovementV2 } from '@/lib/agent-mission-control/improvement-loop'
import { NotFoundError } from '@/lib/agent-mission-control/runner-errors'

const ID_RE = /^[a-z0-9-]{1,200}$/

/**
 * POST /api/agent-ops/copilots/:copilotId/improve/create-v2 — materialize an
 * accepted-for-trial proposal into a REAL V2 draft: new `manifests` +
 * `copilot_versions` rows, `copilots.latest_version_id` moved, and the
 * copilot's LangGraph assistant re-provisioned so the V2 behaviour actually
 * runs. The version stays `draft` — promotion remains the separate,
 * human-triggered promotion route.
 *
 * Body: { proposalId: string }
 * Response: { ok: true; v2VersionId; v2ManifestId; label }
 *
 * Errors: 400 (bad body/ids), 404 (proposal/copilot/version/manifest),
 * 409 (proposal not in 'proposed' state), 503 (backend env missing),
 * 502 (PostgREST / Agent Server — generic message, detail logged server-side).
 */
export async function POST(request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params
  if (!ID_RE.test(copilotId)) {
    return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })
  }

  let body: { proposalId?: string } | null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (body === null || typeof body.proposalId !== 'string' || !ID_RE.test(body.proposalId)) {
    return NextResponse.json({ error: 'proposalId is required' }, { status: 400 })
  }

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  try {
    const created = await createImprovementV2(copilotId, body.proposalId)
    return NextResponse.json({ ok: true, ...created })
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof Error && /expected 'proposed'/.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    console.error('[agent-ops/improve/create-v2] V2 creation failed', err)
    return NextResponse.json({ error: 'V2 creation failed' }, { status: 502 })
  }
}
