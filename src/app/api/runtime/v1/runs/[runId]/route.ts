import { NextResponse } from 'next/server'

import { isValidRunId, requireRuntimeApiAuth } from '@/lib/agent-mission-control/runtime-api-types'

/**
 * GET /api/runtime/v1/runs/:runId — fetch one run's current state.
 *
 * Skeleton: no run store is wired yet, so this always returns a clean 404
 * once auth + shape checks pass. Wiring to the real run store lands with
 * the materialization work.
 */
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = requireRuntimeApiAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { runId } = await params
  if (!isValidRunId(runId)) {
    return NextResponse.json({ error: 'invalid runId' }, { status: 400 })
  }

  return NextResponse.json({ error: 'run not found' }, { status: 404 })
}
