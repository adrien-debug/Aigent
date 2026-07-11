import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'

import { summarize } from '@/lib/agent-mission-control/format'
import { resumeOnAgentServer } from '@/lib/agent-mission-control/langgraph-server'
import { pgrest } from '@/lib/agent-mission-control/postgrest'

/**
 * POST /api/agent-ops/copilots/:copilotId/runs/:runId/resume — human-in-the-loop
 * resume for a LangGraph run that paused for approval.
 *
 * A `langgraph`-runtime run whose write/confirm tool required human sign-off is
 * persisted as `needs-confirmation` with the Agent Server `thread_id` kept
 * (see runner.ts → executeViaLangGraph). This route continues that thread with
 * the operator's decision (`{ approved }`), then appends the resumed steps +
 * tool calls and closes out the run — the same PostgREST perimeter, service
 * role, server only, fail-closed shape the run route uses.
 *
 * Body: { approved: boolean }
 *
 * Flow:
 *   1. Validate `approved` is a boolean (400 otherwise).
 *   2. Fail-closed 503 if the gpu1 backend is not configured (mirrors run/route.ts).
 *   3. Load the run; 404 if missing or copilot mismatch; 409 if it is not
 *      `needs-confirmation`.
 *   4. Require a resumable `thread_id` (409 otherwise).
 *   5. Resume on the Agent Server with the decision.
 *   6. Append the resumed steps (continuing the run's index) + tool_calls, then
 *      PATCH the run to `completed` (or `blocked` when the decision left every
 *      tool call blocked), stamping output_summary + finished_at.
 *
 * Live-only: never fabricates a resume — a resume/persist failure surfaces as 502.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ copilotId: string; runId: string }> }
) {
  const { copilotId, runId } = await params

  let body: { approved?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (typeof body.approved !== 'boolean') {
    return NextResponse.json({ error: 'approved must be a boolean' }, { status: 400 })
  }
  const approved = body.approved

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  // 1) Load the run and gate it: it must exist, belong to this copilot, be
  //    awaiting confirmation, and carry a resumable thread.
  let runRow: Record<string, unknown>
  try {
    const rows = await pgrest<Record<string, unknown>[]>(
      'GET',
      `agent_runs?id=eq.${encodeURIComponent(runId)}&select=*`
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'run not found' }, { status: 404 })
    }
    runRow = rows[0]
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'PostgREST error' }, { status: 502 })
  }

  if ((runRow.copilot_id as string | null) !== copilotId) {
    return NextResponse.json({ error: 'run not found' }, { status: 404 })
  }
  if ((runRow.status as string | null) !== 'needs-confirmation') {
    return NextResponse.json({ error: 'run is not awaiting confirmation' }, { status: 409 })
  }
  const threadId = runRow.thread_id as string | null
  if (!threadId) {
    return NextResponse.json({ error: 'run has no resumable thread' }, { status: 409 })
  }

  // Resolve the copilot's tools (name → id/risk/confirmation) so resumed
  // tool_calls carry real metadata, not hardcoded 'low'/false — the audit trail
  // (unsafe_attempt_count, risk) depends on this being accurate.
  const toolByName = new Map<string, { id: string; risk: string; requiresConfirmation: boolean }>()
  try {
    const toolRows = await pgrest<Record<string, unknown>[]>(
      'GET',
      `tools?copilot_id=eq.${encodeURIComponent(copilotId)}&select=id,name,risk_level,requires_confirmation`
    )
    for (const t of toolRows) {
      toolByName.set(t.name as string, {
        id: t.id as string,
        risk: (t.risk_level as string) ?? 'low',
        requiresConfirmation: t.requires_confirmation === true,
      })
    }
  } catch {
    // Non-fatal — fall back to name-based tool_id below.
  }

  // 2) Continue the thread with the operator's decision, then persist the
  //    resumed steps/tool calls and close the run. Any failure here is a 502.
  try {
    const result = await resumeOnAgentServer({ threadId, approved })

    // Continue the run's step numbering from the max existing index + 1.
    const lastStepRows = await pgrest<Record<string, unknown>[]>(
      'GET',
      `agent_run_steps?run_id=eq.${encodeURIComponent(runId)}&select=index&order=index.desc&limit=1`
    )
    let nextIndex =
      typeof lastStepRows[0]?.index === 'number' ? (lastStepRows[0].index as number) + 1 : 0

    // Append the resumed steps (LangGraphServerStep kinds are already DB-valid).
    for (const step of result.steps) {
      await pgrest('POST', 'agent_run_steps', {
        id: randomUUID(),
        run_id: runId,
        index: nextIndex,
        kind: step.kind,
        title: step.title,
        detail: step.detail,
        status: step.status,
        started_at: new Date().toISOString(),
        duration_ms: 0,
        tool_call_id: null,
      })
      nextIndex += 1
    }

    // Append the resumed tool calls with the REAL tool_id/risk/confirmation.
    for (const tc of result.toolCalls) {
      const dbTool = toolByName.get(tc.toolName)
      await pgrest('POST', 'tool_calls', {
        id: randomUUID(),
        run_id: runId,
        tool_id: dbTool?.id ?? tc.toolName,
        tool_name: tc.toolName,
        arguments_summary: tc.argumentsSummary || '{}',
        result_summary: tc.resultSummary,
        status: tc.status,
        risk_level: dbTool?.risk ?? 'low',
        // A tool that went through this approval path required confirmation.
        required_confirmation: dbTool?.requiresConfirmation ?? true,
        latency_ms: 0,
      })
    }

    // A rejection that left every tool call blocked is a `blocked` run;
    // anything else (including an approval) completes.
    const allBlocked =
      result.toolCalls.length > 0 && result.toolCalls.every((tc) => tc.status === 'blocked')
    const status = allBlocked && approved === false ? 'blocked' : 'completed'
    const outputSummary = summarize(result.finalText || '(empty response)')

    // Re-aggregate the run's counters from the full tool_calls table so
    // tool_call_count / unsafe_attempt_count reflect the resumed rows (they were
    // 0 at pause). Re-read after the inserts above.
    const allCalls = await pgrest<Record<string, unknown>[]>(
      'GET',
      `tool_calls?run_id=eq.${encodeURIComponent(runId)}&select=status`
    )
    const toolCallCount = allCalls.length
    const unsafeAttemptCount = allCalls.filter((c) => c.status === 'blocked').length

    await pgrest('PATCH', `agent_runs?id=eq.${encodeURIComponent(runId)}`, {
      status,
      output_summary: outputSummary,
      finished_at: new Date().toISOString(),
      tool_call_count: toolCallCount,
      unsafe_attempt_count: unsafeAttemptCount,
    })

    return NextResponse.json({
      ok: true,
      runId,
      status,
      outputSummary,
      approved,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'run resume failed'
    // The dev Agent Server keeps thread state in memory; a restart drops it and
    // resuming a lost thread 404s. Surface that as an actionable 409 (the run is
    // unrecoverable — relaunch it) rather than a raw 502.
    if (/\b404\b|not found/i.test(message)) {
      return NextResponse.json(
        { error: 'the approval thread was lost (Agent Server restarted) — relaunch the run', threadLost: true },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
