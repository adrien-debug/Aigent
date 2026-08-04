import { NextResponse } from 'next/server'

import {
  analyzeAndPropose,
  resolveImprovementEvidence,
  runAutoImprovementCycle,
} from '@/lib/agent-mission-control/improvement-loop'
import { isPgrestTimeout, pgrest } from '@/lib/agent-mission-control/postgrest'
import { NotFoundError, ProviderUnavailableError } from '@/lib/agent-mission-control/runner-errors'

// Same id shape family as the sibling promotion route — fast 400 on garbage,
// and it closes the PostgREST `in.(...)`/filter-syntax hazard.
const ID_RE = /^[a-z0-9-]{1,200}$/

// One analysis in flight per copilot (per server process). The DB open-cycle
// check below is check-then-act over a multi-second LLM window: two concurrent
// POSTs would both pass it and open two cycles (double proposal, double LLM
// spend). This closes the race in-process; the DB check stays as the
// cross-restart source of truth.
const inFlightAnalyses = new Set<string>()

/**
 * POST /api/agent-ops/copilots/:copilotId/improve/analyze — run the REAL
 * Improvement Loop analysis: collect live signals (failing test cases,
 * benchmark scores, runs, LangGraph threads, LangSmith traces), have the
 * architect model root-cause the failures and emit a validated manifest
 * proposal, and persist it as an `improvement_proposals` row.
 *
 * Body: {
 *   triggeredBy?: string,
 *   qualificationRunId: string,
 *   mode?: 'proposal' | 'auto-cycle',
 *   maxIterations?: number,
 *   maxCostUsd?: number
 * }
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

  let body: {
    triggeredBy?: unknown
    qualificationRunId?: unknown
    mode?: unknown
    maxIterations?: unknown
    maxCostUsd?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  // `null` is valid JSON: reading .triggeredBy off it would throw → 500 instead of 400.
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })
  }
  // Bounded: the value is persisted as `improvement_proposals.created_by`.
  if (body.triggeredBy !== undefined && (typeof body.triggeredBy !== 'string' || body.triggeredBy.length > 200)) {
    return NextResponse.json({ error: 'triggeredBy must be a string of at most 200 characters' }, { status: 400 })
  }
  if (typeof body.qualificationRunId !== 'string' || !ID_RE.test(body.qualificationRunId)) {
    return NextResponse.json({ error: 'qualificationRunId is required' }, { status: 400 })
  }
  const mode = body.mode ?? 'proposal'
  if (mode !== 'proposal' && mode !== 'auto-cycle') {
    return NextResponse.json({ error: "mode must be 'proposal' or 'auto-cycle'" }, { status: 400 })
  }
  if (
    body.maxIterations !== undefined &&
    (typeof body.maxIterations !== 'number' ||
      !Number.isInteger(body.maxIterations) ||
      body.maxIterations < 1 ||
      body.maxIterations > 5)
  ) {
    return NextResponse.json({ error: 'maxIterations must be an integer from 1 to 5' }, { status: 400 })
  }
  if (
    body.maxCostUsd !== undefined &&
    (typeof body.maxCostUsd !== 'number' ||
      !Number.isFinite(body.maxCostUsd) ||
      body.maxCostUsd <= 0 ||
      body.maxCostUsd > 10)
  ) {
    return NextResponse.json({ error: 'maxCostUsd must be a finite number in (0, 10]' }, { status: 400 })
  }

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  if (inFlightAnalyses.has(copilotId)) {
    return NextResponse.json(
      { error: 'an analysis is already running for this copilot — wait for it to finish' },
      { status: 409 }
    )
  }
  inFlightAnalyses.add(copilotId)
  try {
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
      // pgrest() timeout (PgrestError 504, postgrest.ts) → 504 gateway timeout;
      // any other upstream failure stays a generic 502. Same body either way.
      return NextResponse.json({ error: 'failed to check for an open cycle' }, { status: isPgrestTimeout(err) ? 504 : 502 })
    }

    try {
      const evidence = await resolveImprovementEvidence(copilotId, body.qualificationRunId)
      if (mode === 'auto-cycle') {
        if (body.maxIterations !== undefined && body.maxIterations !== 1) {
          return NextResponse.json(
            { error: 'the downstream auto-cycle is limited to one V2 before human decision' },
            { status: 400 },
          )
        }
        const result = await runAutoImprovementCycle(copilotId, {
          evidence,
          maxIterations: 1,
          maxCostUsd: body.maxCostUsd as number | undefined,
        })
        return NextResponse.json({ ok: true, result, evidence })
      }
      const { proposal, signals } = await analyzeAndPropose(
        copilotId,
        body.triggeredBy?.trim() || 'operator',
        evidence,
      )
      return NextResponse.json({ ok: true, proposal, sources: signals.sources })
    } catch (err) {
      if (err instanceof NotFoundError) {
        return NextResponse.json({ error: err.message }, { status: 404 })
      }
      if (err instanceof ProviderUnavailableError) {
        return NextResponse.json({ error: err.message }, { status: 503 })
      }
      console.error('[agent-ops/improve/analyze] analysis failed', err)
      return NextResponse.json({ error: 'analysis failed' }, { status: isPgrestTimeout(err) ? 504 : 502 })
    }
  } finally {
    inFlightAnalyses.delete(copilotId)
  }
}
