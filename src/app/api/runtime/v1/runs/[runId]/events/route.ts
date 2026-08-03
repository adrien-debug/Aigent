import { NextResponse } from 'next/server'

import { isPgrestTimeout, pgrest } from '@/lib/agent-mission-control/postgrest'
import { isValidRunId, resolveRuntimeTenant, tenantCanSeeProject } from '@/lib/agent-mission-control/runtime-api-types'

/**
 * GET /api/runtime/v1/runs/:runId/events — the ordered event log for one run.
 *
 * Wired to the real `agent_run_steps` store (the runner writes one row per
 * step). Fail-closed: an unknown run → 404 (not an empty 200, which a consumer
 * cannot tell apart from "a run with no steps"); backend unreachable → 502/504.
 */
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await resolveRuntimeTenant(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { runId } = await params
  if (!isValidRunId(runId)) {
    return NextResponse.json({ error: 'invalid runId' }, { status: 400 })
  }

  try {
    // Confirm the run exists first, so "no steps yet" (200 []) is never
    // confused with "no such run" (404).
    const runRows = await pgrest<Record<string, unknown>[]>(
      'GET',
      `agent_runs?id=eq.${encodeURIComponent(runId)}&select=id,project_id&limit=1`
    )
    const runRow = runRows[0]
    if (!runRow) {
      return NextResponse.json({ error: 'run not found' }, { status: 404 })
    }
    // Another tenant's run reads as nonexistent — 404, never 403.
    if (!tenantCanSeeProject(auth.tenant, (runRow.project_id as string | null) ?? null)) {
      return NextResponse.json({ error: 'run not found' }, { status: 404 })
    }

    const steps = await pgrest<Record<string, unknown>[]>(
      'GET',
      `agent_run_steps?run_id=eq.${encodeURIComponent(runId)}&select=id,index,kind,title,detail,status,started_at,duration_ms&order=index.asc`
    )
    const events = steps.map((s) => ({
      id: s.id as string,
      runId,
      sequence: (s.index as number) ?? 0,
      type: (s.kind as string | null) ?? 'step',
      data: {
        title: (s.title as string | null) ?? null,
        detail: (s.detail as string | null) ?? null,
        status: (s.status as string | null) ?? null,
        durationMs: (s.duration_ms as number | null) ?? null,
      },
      createdAt: (s.started_at as string | null) ?? null,
    }))
    return NextResponse.json({ ok: true, runId, count: events.length, events })
  } catch (err) {
    console.error('[runtime/v1/runs/:runId/events] read failed', err)
    return NextResponse.json({ error: 'events lookup failed' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
}
