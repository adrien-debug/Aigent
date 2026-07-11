import { NextResponse } from 'next/server'

import { executeCopilotRun } from '@/lib/agent-mission-control/runner'
import { pgrest } from '@/lib/agent-mission-control/postgrest'

/**
 * POST /api/agent-ops/copilots/:copilotId/run — execute a REAL run of a
 * copilot against the live OpenAI model, persisted via the shared runner
 * (`executeCopilotRun`), which writes `agent_runs` + `agent_run_steps` to the
 * gpu1 PostgREST perimeter (service_role, server only).
 *
 * Body: { userInput: string }
 *
 * Flow:
 *   1. Fail-closed 503 if the gpu1 backend is not configured (mirrors the
 *      existing PATCH/promotion routes for this resource).
 *   2. Read the copilot (model, production/latest version, project) — inline,
 *      single-owner PostgREST GET, same shape as ./route.ts's PATCH handler.
 *   3. Read that version's manifest (system_prompt_summary, max_steps_per_run).
 *   4. Delegate execution + persistence to executeCopilotRun (real OpenAI
 *      call; OPENAI_API_KEY is checked inside the runner's OpenAI client).
 *
 * Live-only: never fabricates a run — executeCopilotRun persists a `failed`
 * agent_runs row on OpenAI failure rather than swallowing the error.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ copilotId: string }> }
) {
  const { copilotId } = await params

  let body: { userInput?: string; allowFallback?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (typeof body.userInput !== 'string' || body.userInput.trim().length === 0) {
    return NextResponse.json({ error: 'userInput is required' }, { status: 400 })
  }
  if (body.allowFallback !== undefined && typeof body.allowFallback !== 'boolean') {
    return NextResponse.json({ error: 'allowFallback must be a boolean' }, { status: 400 })
  }
  const userInput = body.userInput

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  // 1) Load the copilot: model, project, and which version is serving.
  let copilotRow: Record<string, unknown>
  try {
    const rows = await pgrest<Record<string, unknown>[]>(
      'GET',
      `copilots?id=eq.${encodeURIComponent(copilotId)}&select=*`
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'copilot not found' }, { status: 404 })
    }
    copilotRow = rows[0]
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'PostgREST error' }, { status: 502 })
  }

  const versionId =
    (copilotRow.production_version_id as string | null) ?? (copilotRow.latest_version_id as string | null)
  if (!versionId) {
    return NextResponse.json({ error: 'copilot has no production or latest version' }, { status: 409 })
  }
  const projectId = copilotRow.project_id as string | null
  if (!projectId) {
    return NextResponse.json(
      { error: 'copilot has no project assignment (still on the validation bench)' },
      { status: 409 }
    )
  }
  const model = (copilotRow.model as string | null) ?? ''
  const modelProvider = (copilotRow.model_provider as string | null) ?? 'openai'

  // 2) Load the serving version, then its manifest.
  let systemPromptSummary = `You are ${copilotRow.name as string}, an autonomous agent.`
  let maxStepsPerRun = 1
  try {
    const versionRows = await pgrest<Record<string, unknown>[]>(
      'GET',
      `copilot_versions?id=eq.${encodeURIComponent(versionId)}&select=*`
    )
    if (versionRows.length === 0) {
      return NextResponse.json({ error: 'version not found' }, { status: 404 })
    }
    const manifestId = versionRows[0].manifest_id as string | null
    if (manifestId) {
      const manifestRows = await pgrest<Record<string, unknown>[]>(
        'GET',
        `manifests?id=eq.${encodeURIComponent(manifestId)}&select=*`
      )
      const manifestRow = manifestRows[0]
      if (manifestRow) {
        if (typeof manifestRow.system_prompt_summary === 'string' && manifestRow.system_prompt_summary.length > 0) {
          systemPromptSummary = manifestRow.system_prompt_summary
        }
        if (typeof manifestRow.max_steps_per_run === 'number') {
          maxStepsPerRun = manifestRow.max_steps_per_run
        }
      }
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'PostgREST error' }, { status: 502 })
  }

  // 3) Execute — real OpenAI call + real agent_runs/agent_run_steps persistence.
  try {
    const result = await executeCopilotRun({
      copilotId,
      versionId,
      projectId,
      model,
      modelProvider: modelProvider as import('@/lib/agent-mission-control/types').ModelProvider,
      systemPromptSummary,
      userInput,
      maxSteps: maxStepsPerRun,
      allowFallback: body.allowFallback,
    })

    return NextResponse.json({
      ok: true,
      runId: result.runId,
      status: result.status,
      outputSummary: result.outputSummary,
      latencyMs: result.latencyMs,
      costUsd: result.costUsd,
      traceUrl: result.traceUrl,
      resolvedProvider: result.resolvedProvider,
      resolvedModel: result.resolvedModel,
      fallbackUsed: result.fallbackUsed,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'run execution failed' },
      { status: 502 }
    )
  }
}
