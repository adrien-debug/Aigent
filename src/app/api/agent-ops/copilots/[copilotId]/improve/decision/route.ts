import { NextResponse } from 'next/server'

import { decideProposal } from '@/lib/agent-mission-control/improvement-loop'
import { NotFoundError } from '@/lib/agent-mission-control/runner-errors'

const ID_RE = /^[a-z0-9-]{1,200}$/

/**
 * POST /api/agent-ops/copilots/:copilotId/improve/decision — persist the HUMAN
 * gate of the Improvement Loop: approve (only once the V2 draft exists) or
 * reject a proposal. This records the decision; it does NOT promote anything —
 * production promotion stays behind the existing promotion route, always
 * operator-triggered.
 *
 * Body: { proposalId: string; decision: 'approved' | 'rejected'; decidedBy?: string }
 * Response: { ok: true; status }
 *
 * Errors: 400 (bad body/ids), 404 (proposal/ownership), 409 (already decided /
 * approve without V2), 503 (backend env missing), 502 (PostgREST — generic).
 */
export async function POST(request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params
  if (!ID_RE.test(copilotId)) {
    return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })
  }

  let body: { proposalId?: string; decision?: string; decidedBy?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (typeof body.proposalId !== 'string' || !ID_RE.test(body.proposalId)) {
    return NextResponse.json({ error: 'proposalId is required' }, { status: 400 })
  }
  if (body.decision !== 'approved' && body.decision !== 'rejected') {
    return NextResponse.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 })
  }
  if (body.decidedBy !== undefined && typeof body.decidedBy !== 'string') {
    return NextResponse.json({ error: 'decidedBy must be a string' }, { status: 400 })
  }

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  try {
    await decideProposal(copilotId, body.proposalId, body.decision, body.decidedBy?.trim() || 'operator')
    return NextResponse.json({ ok: true, status: body.decision })
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof Error && /already decided|only be approved/.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    console.error('[agent-ops/improve/decision] decision failed', err)
    return NextResponse.json({ error: 'decision failed' }, { status: 502 })
  }
}
