import { NextResponse } from 'next/server'

import { isPgrestTimeout, pgrest } from '@/lib/agent-mission-control/postgrest'
import { isValidRunId, resolveRuntimeTenant, tenantCanSeeProject } from '@/lib/agent-mission-control/runtime-api-types'

/**
 * POST /api/runtime/v1/runs/:runId/resume — resume a run that is
 * `waiting_on_input` (HITL interruption) with the caller-supplied payload.
 *
 * The runtime/v1 run path is SYNCHRONOUS (POST /agents/:id/runs runs to
 * completion), so there is no async resume orchestration on this surface yet.
 * Rather than the old unconditional 404 (which lied that a real, existing run
 * "was not found"), this reports honestly: 404 only when the run genuinely does
 * not exist, otherwise 501 — the run exists, resume is not implemented here.
 * Wiring the real interruption/resume path lands with the async run store.
 */
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await resolveRuntimeTenant(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { runId } = await params
  if (!isValidRunId(runId)) {
    return NextResponse.json({ error: 'invalid runId' }, { status: 400 })
  }

  try {
    const rows = await pgrest<Record<string, unknown>[]>(
      'GET',
      `agent_runs?id=eq.${encodeURIComponent(runId)}&select=id,project_id&limit=1`
    )
    const run = rows[0]
    if (!run) {
      return NextResponse.json({ error: 'run not found' }, { status: 404 })
    }
    // Another tenant's run reads as nonexistent — 404, never 403.
    if (!tenantCanSeeProject(auth.tenant, (run.project_id as string | null) ?? null)) {
      return NextResponse.json({ error: 'run not found' }, { status: 404 })
    }
    return NextResponse.json(
      {
        error: 'resume not supported: runtime/v1 runs are synchronous',
        runId,
      },
      { status: 501 }
    )
  } catch (err) {
    console.error('[runtime/v1/runs/:runId/resume] lookup failed', err)
    return NextResponse.json({ error: 'run lookup failed' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
}
