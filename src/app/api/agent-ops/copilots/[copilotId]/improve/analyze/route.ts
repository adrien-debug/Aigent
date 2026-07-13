import { NextResponse } from 'next/server'

import { analyzeAndPropose } from '@/lib/agent-mission-control/improvement-loop'
import { pgrest } from '@/lib/agent-mission-control/postgrest'
import { NotFoundError, ProviderUnavailableError } from '@/lib/agent-mission-control/runner-errors'

// Same id shape family as the sibling promotion route — fast 400 on garbage,
// and it closes the PostgREST `in.(...)`/filter-syntax hazard.
const ID_RE = /^[a-z0-9-]{1,200}$/

/**
 * POST /api/agent-ops/copilots/:copilotId/improve/analyze — run the REAL
 * Improvement Loop analysis: collect live signals (failing test cases,
 * benchmark scores, runs, LangGraph threads, LangSmith traces), have the
 * architect model root-cause the failures and emit a validated manifest
 * proposal, and persist it as an `improvement_proposals` row.
 *
 * Body: { triggeredBy?: string }
 * Response: { ok: true; proposal; sources }
 *
 * One OPEN cycle at a time: if an undecided proposal (proposed/v2-created)
 * already exists for this copilot, respond 409 — the loop ends with a human
 * decision before a new one opens. Errors: 400 (bad body), 404 (copilot),
 * 409 (open cycle), 503 (backend/OpenAI env missing), 502 (collection/LLM/
 * PostgREST — generic message, detail logged server-side only).
 */
export async function POST(request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params
  if (!ID_RE.test(copilotId)) {
    return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })
  }

  let body: { triggeredBy?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (body.triggeredBy !== undefined && typeof body.triggeredBy !== 'string') {
    return NextResponse.json({ error: 'triggeredBy must be a string' }, { status: 400 })
  }

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  try {
    const openRows = await pgrest<Record<string, unknown>[]>(
      'GET',
      `improvement_proposals?copilot_id=eq.${encodeURIComponent(copilotId)}&status=in.(proposed,v2-created)&select=id&limit=1`
    )
    if (openRows.length > 0) {
      return NextResponse.json(
        { error: 'an improvement cycle is already open for this copilot — decide it first', proposalId: openRows[0].id },
        { status: 409 }
      )
    }
  } catch (err) {
    console.error('[agent-ops/improve/analyze] failed to check for an open cycle', err)
    return NextResponse.json({ error: 'failed to check for an open cycle' }, { status: 502 })
  }

  try {
    const { proposal, signals } = await analyzeAndPropose(copilotId, body.triggeredBy?.trim() || 'operator')
    return NextResponse.json({ ok: true, proposal, sources: signals.sources })
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof ProviderUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    console.error('[agent-ops/improve/analyze] analysis failed', err)
    return NextResponse.json({ error: 'analysis failed' }, { status: 502 })
  }
}
