import { NextResponse } from 'next/server'

import { isPgrestTimeout, pgrest } from '@/lib/agent-mission-control/postgrest'
import {
  RUNTIME_CONTRACT_VERSION,
  isValidRunId,
  resolveRuntimeTenant,
  tenantCanSeeProject,
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
  const auth = await resolveRuntimeTenant(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { runId } = await params
  if (!isValidRunId(runId)) {
    return NextResponse.json({ error: 'invalid runId' }, { status: 400 })
  }

  try {
    // Only real `agent_runs` columns are selected. `fallback_used` and
    // `interrupted` are NOT persisted columns (no migration defines them — the
    // runner tracks `interrupted` in-memory only and never writes it, and there
    // is no fallback column at all). Requesting them made PostgREST reject the
    // whole select with 42703 "column does not exist" → the catch below turned
    // every real read into a 502. They are reported as null in the response
    // (unmeasured → null), which is the honest value until a column exists.
    const rows = await pgrest<Record<string, unknown>[]>(
      'GET',
      `agent_runs?id=eq.${encodeURIComponent(runId)}&select=id,copilot_id,project_id,status,input_summary,output_summary,started_at,finished_at,latency_ms,cost_usd,resolved_provider,resolved_model,model_unverified&limit=1`
    )
    const run = rows[0]
    if (!run) {
      return NextResponse.json({ error: 'run not found' }, { status: 404 })
    }
    // A run belonging to another tenant reads as "not found" — 404, never 403.
    // The run's existence is itself information the owning tenant did not
    // consent to leak.
    if (!tenantCanSeeProject(auth.tenant, (run.project_id as string | null) ?? null)) {
      return NextResponse.json({ error: 'run not found' }, { status: 404 })
    }
    return NextResponse.json({
      contractVersion: RUNTIME_CONTRACT_VERSION,
      id: run.id as string,
      agentId: run.copilot_id as string,
      projectKey: (run.project_id as string | null) ?? null,
      status: toRuntimeRunStatus((run.status as AgentRunStatus) ?? 'running'),
      input: (run.input_summary as string | null) ?? null,
      output: (run.output_summary as string | null) ?? null,
      createdAt: (run.started_at as string | null) ?? null,
      updatedAt: (run.finished_at as string | null) ?? (run.started_at as string | null) ?? null,
      latencyMs: (run.latency_ms as number | null) ?? null,
      costUsd: (run.cost_usd as number | null) ?? null,
      resolvedProvider: (run.resolved_provider as string | null) ?? null,
      resolvedModel: (run.resolved_model as string | null) ?? null,
      modelUnverified: (run.model_unverified as boolean | null) ?? null,
      fallbackUsed: (run.fallback_used as boolean | null) ?? null,
      interrupted: (run.interrupted as boolean | null) ?? null,
    })
  } catch (err) {
    console.error('[runtime/v1/runs/:runId] read failed', err)
    return NextResponse.json({ error: 'run lookup failed' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
}
