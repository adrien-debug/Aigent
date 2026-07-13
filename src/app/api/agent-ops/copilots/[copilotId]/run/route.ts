import { NextResponse } from 'next/server'

import { executeCopilotRun } from '@/lib/agent-mission-control/runner'
import { pgrest } from '@/lib/agent-mission-control/postgrest'

// Default step budget when the manifest carries no usable `max_steps_per_run`.
// Matches DEFAULT_MAX_STEPS in src/lib/agent-mission-control/copilot-behavior.ts
// and the legacy graph's `maxSteps: 12` (src/langgraph/agent-builder-graph.mjs).
// A budget of 1 breaks the direct model-router path: runner.ts derives
// `maxTurns = Math.max(1, maxSteps)` and loops `for (; turn < maxTurns; …)`,
// so with maxTurns=1 the loop exits right after executing a tool call on the
// first turn — the model never gets to read its own tool result.
const DEFAULT_MAX_STEPS_PER_RUN = 12

// Hard ceiling on the request body's `userInput`. Nothing downstream (this
// route, the runner's message array, model-router) truncates or bounds it
// before it's shipped to the live OpenAI call — an unbounded string is a
// real cost/DoS surface (and, for the LangGraph path, an unbounded
// recursion_limit input). 32k chars is far beyond any real chat turn while
// still rejecting pathological payloads outright (400, not a silent
// truncation that would quietly change what the model sees).
const MAX_USER_INPUT_LENGTH = 32_000

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
  if (body.userInput.length > MAX_USER_INPUT_LENGTH) {
    return NextResponse.json(
      { error: `userInput exceeds the ${MAX_USER_INPUT_LENGTH}-character limit` },
      { status: 400 }
    )
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
    // Never forward the raw PostgREST error text to the client: it can
    // contain schema/constraint details or query internals. Log server-side
    // for debugging, return a generic message (same status code, same
    // `error` field contract as before).
    console.error('[agent-ops/copilots/run] failed to load copilot', err)
    return NextResponse.json({ error: 'failed to load copilot' }, { status: 502 })
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
  let maxStepsPerRun = DEFAULT_MAX_STEPS_PER_RUN
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
        // Don't trust the DB value blindly: only accept a finite integer >= 1.
        // 0, negative, NaN, Infinity, or a non-numeric field all fall back to
        // DEFAULT_MAX_STEPS_PER_RUN rather than reintroducing an absurd budget.
        const rawMaxSteps = manifestRow.max_steps_per_run
        if (
          typeof rawMaxSteps === 'number' &&
          Number.isFinite(rawMaxSteps) &&
          Number.isInteger(rawMaxSteps) &&
          rawMaxSteps >= 1
        ) {
          maxStepsPerRun = rawMaxSteps
        }
      }
    }
  } catch (err) {
    // Same rationale as above: don't leak raw PostgREST error text.
    console.error('[agent-ops/copilots/run] failed to load version/manifest', err)
    return NextResponse.json({ error: 'failed to load version or manifest' }, { status: 502 })
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
      // Null when the real model couldn't be verified (see modelUnverified) —
      // never a guess dressed up as the model that ran.
      resolvedModel: result.resolvedModel,
      fallbackUsed: result.fallbackUsed,
      // True when resolvedModel/fallbackUsed could NOT be verified against
      // what actually executed (LangGraph path with no readable response
      // metadata). Callers must not treat resolvedModel/fallbackUsed as fact
      // when this is true.
      modelUnverified: result.modelUnverified,
      // Human-in-the-loop: when the LangGraph run paused, the client shows an
      // Approve/Reject prompt and calls the resume route with this runId.
      interrupted: result.interrupted,
      interruptMessage: result.interruptMessage,
      // The tool awaiting approval (name + args) so the operator approves with
      // full context instead of blind — only meaningful when interrupted.
      pendingTool: result.interrupted ? result.pendingTool ?? null : null,
    })
  } catch (err) {
    // Same rationale as the two catches above: executeCopilotRun's errors can
    // originate from pgrest (PostgREST response bodies / table & column names)
    // or the OpenAI client — never forward raw internal error text to the
    // client. Log server-side for debugging, return a generic message.
    console.error('[agent-ops/copilots/run] run execution failed', err)
    return NextResponse.json({ error: 'run execution failed' }, { status: 502 })
  }
}
