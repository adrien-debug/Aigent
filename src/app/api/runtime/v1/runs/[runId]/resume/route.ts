import { NextResponse } from 'next/server'

import { isValidRunId, requireRuntimeApiAuth } from '@/lib/agent-mission-control/runtime-api-types'

/**
 * POST /api/runtime/v1/runs/:runId/resume — resume a run that is
 * `waiting_on_input` (HITL interruption) with the caller-supplied payload.
 *
 * Skeleton: no run store is wired yet, so this always returns a clean 404
 * once auth + shape checks pass. Wiring to the real run orchestrator's
 * resume path lands with the materialization work — see
 * docs/projects/real-estate-agent/runtime-api.md for the intended
 * interruption/resume contract.
 */
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = requireRuntimeApiAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { runId } = await params
  if (!isValidRunId(runId)) {
    return NextResponse.json({ error: 'invalid runId' }, { status: 400 })
  }

  return NextResponse.json({ error: 'run not found' }, { status: 404 })
}
