import { NextResponse } from 'next/server'

import { isPgrestTimeout, pgrest } from '@/lib/agent-mission-control/postgrest'
import {
  isValidRunId,
  requireRuntimeApiAuth,
  toRuntimeRunStatus,
} from '@/lib/agent-mission-control/runtime-api-types'
import type { AgentRunStatus } from '@/lib/agent-mission-control/types'

/**
 * GET /api/runtime/v1/runs/:runId — fetch one run's current state.
 *
 * Wired to the real `agent_runs` store the runner writes: POST
 * /agents/:id/runs persists a row keyed on the `runId` it returns, so that id
 * MUST resolve here (it previously 404'd unconditionally — a consumer that
 * started a run then polled its status was permanently broken). Fail-closed:
 * unknown id → 404, backend unreachable → 502/504. The status is mapped onto
 * the published RuntimeRunStatus contract, never the internal value.
 */
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = requireRuntimeApiAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { runId } = await params
  if (!isValidRunId(runId)) {
    return NextResponse.json({ error: 'invalid runId' }, { status: 400 })
  }

  try {
    const rows = await pgrest<Record<string, unknown>[]>(
      'GET',
      `agent_runs?id=eq.${encodeURIComponent(runId)}&select=id,copilot_id,project_id,status,input_summary,output_summary,started_at,finished_at&limit=1`
    )
    const run = rows[0]
    if (!run) {
      return NextResponse.json({ error: 'run not found' }, { status: 404 })
    }
    return NextResponse.json({
      id: run.id as string,
      agentId: run.copilot_id as string,
      projectKey: (run.project_id as string | null) ?? null,
      status: toRuntimeRunStatus((run.status as AgentRunStatus) ?? 'running'),
      input: (run.input_summary as string | null) ?? null,
      output: (run.output_summary as string | null) ?? null,
      createdAt: (run.started_at as string | null) ?? null,
      updatedAt: (run.finished_at as string | null) ?? (run.started_at as string | null) ?? null,
    })
  } catch (err) {
    console.error('[runtime/v1/runs/:runId] read failed', err)
    return NextResponse.json({ error: 'run lookup failed' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
}
