import { NextResponse } from 'next/server'

import { executeCopilotRun } from '@/lib/agent-mission-control/runner'

/**
 * POST /api/agent-ops/copilots/:copilotId/run — execute a REAL run of a
 * copilot against the live Anthropic model, persisted via the shared runner
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
 *   4. Delegate execution + persistence to executeCopilotRun (real Anthropic
 *      call; ANTHROPIC_API_KEY is checked inside getAnthropicClient()).
 *
 * Live-only: never fabricates a run — executeCopilotRun persists a `failed`
 * agent_runs row on Anthropic failure rather than swallowing the error.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ copilotId: string }> }
) {
  const { copilotId } = await params

  let body: { userInput?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (typeof body.userInput !== 'string' || body.userInput.trim().length === 0) {
    return NextResponse.json({ error: 'userInput is required' }, { status: 400 })
  }
  const userInput = body.userInput

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  async function get(pathAndQuery: string): Promise<Record<string, unknown>[]> {
    const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      throw new Error(`PostgREST ${res.status} on ${pathAndQuery}: ${(await res.text()).slice(0, 200)}`)
    }
    return (await res.json()) as Record<string, unknown>[]
  }

  // 1) Load the copilot: model, project, and which version is serving.
  let copilotRow: Record<string, unknown>
  try {
    const rows = await get(`copilots?id=eq.${encodeURIComponent(copilotId)}&select=*`)
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

  // 2) Load the serving version, then its manifest.
  let systemPromptSummary = `You are ${copilotRow.name as string}, an autonomous agent.`
  let maxStepsPerRun = 1
  try {
    const versionRows = await get(`copilot_versions?id=eq.${encodeURIComponent(versionId)}&select=*`)
    if (versionRows.length === 0) {
      return NextResponse.json({ error: 'version not found' }, { status: 404 })
    }
    const manifestId = versionRows[0].manifest_id as string | null
    if (manifestId) {
      const manifestRows = await get(`manifests?id=eq.${encodeURIComponent(manifestId)}&select=*`)
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

  // 3) Execute — real Anthropic call + real agent_runs/agent_run_steps persistence.
  try {
    const result = await executeCopilotRun({
      copilotId,
      versionId,
      projectId,
      model,
      systemPromptSummary,
      userInput,
      maxSteps: maxStepsPerRun,
    })

    return NextResponse.json({
      ok: true,
      runId: result.runId,
      status: result.status,
      outputSummary: result.outputSummary,
      latencyMs: result.latencyMs,
      costUsd: result.costUsd,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'run execution failed' },
      { status: 502 }
    )
  }
}
