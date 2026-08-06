import { NextResponse } from 'next/server'

import { decideProposal } from '@/lib/agent-mission-control/improvement-loop'
import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'
import { isConflict, withInFlightGuard } from '@/lib/agent-mission-control/request-in-flight-guard'
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

  let body: { proposalId?: string; decision?: string; decidedBy?: string } | null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  // `null` is valid JSON: reading .proposalId off it would throw → 500 instead of 400.
  if (body === null || typeof body.proposalId !== 'string' || !ID_RE.test(body.proposalId)) {
    return NextResponse.json({ error: 'proposalId is required' }, { status: 400 })
  }
  if (body.decision !== 'approved' && body.decision !== 'rejected') {
    return NextResponse.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 })
  }
  if (body.decidedBy !== undefined && (typeof body.decidedBy !== 'string' || body.decidedBy.length > 200)) {
    return NextResponse.json({ error: 'decidedBy must be a string of at most 200 characters' }, { status: 400 })
  }

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  // Double-submit guard: one concurrent decision per copilot+proposal per
  // process. decideProposal writes to the DB; a duplicate concurrent call
  // would race on the state-machine check and could double-write.
  const proposalId = body.proposalId as string
  const decision = body.decision as 'approved' | 'rejected'
  const result = await withInFlightGuard(
    `decide-proposal:${copilotId}:${proposalId}`,
    async () => {
      try {
        await decideProposal(copilotId, proposalId, decision, body.decidedBy?.trim() || 'operator')
        return { ok: true as const, status: decision }
      } catch (err) {
        if (err instanceof NotFoundError) {
          return { routeError: err.message, routeStatus: 404 as const }
        }
        if (err instanceof Error && /already decided|only be approved/.test(err.message)) {
          return { routeError: err.message, routeStatus: 409 as const }
        }
        console.error('[agent-ops/improve/decision] decision failed', err)
        return { routeError: 'decision failed', routeStatus: (isPgrestTimeout(err) ? 504 : 502) as 504 | 502 }
      }
    }
  ).catch((err) => {
    // withInFlightGuard itself does not throw (fn errors bubble here only if
    // the outer try/catch above re-throws — belt-and-suspenders for linter).
    console.error('[agent-ops/improve/decision] unexpected error', err)
    return { routeError: 'decision failed', routeStatus: 502 as const }
  })

  if (isConflict(result)) {
    return NextResponse.json({ error: 'request already in progress' }, { status: 409 })
  }
  if ('routeError' in result) {
    return NextResponse.json({ error: result.routeError }, { status: result.routeStatus })
  }
  return NextResponse.json({ ok: true, status: result.status })
}
