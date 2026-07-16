import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'

import { summarize } from '@/lib/agent-mission-control/format'
import { resumeOnAgentServer } from '@/lib/agent-mission-control/langgraph-server'
import { pgrest } from '@/lib/agent-mission-control/postgrest'
import { resolveRunAssistantId } from '@/lib/agent-mission-control/resolve-run-assistant'

// Default step budget when the manifest carries no usable `max_steps_per_run`.
// Mirrors DEFAULT_MAX_STEPS_PER_RUN in ../../run/route.ts — the resume path
// must derive the SAME recursion_limit the original run used, not the SDK's
// unrelated default (see recursionLimitFor in langgraph-server.ts).
const DEFAULT_MAX_STEPS_PER_RUN = 12

// Shape guards for the two path params — same family as every sibling route:
// copilot ids are `makeId('copilot', slug)` (lowercase alphanumerics/hyphens,
// bounded — COPILOT_ID_RE in ../../../run/route.ts), run ids are randomUUID()
// minted by the runner (UUID_RE in architect/runs/[id]/route.ts). Both are
// interpolated into PostgREST `eq.` filters below; rejecting anything else up
// front is a fast, safe 400 (no valid id is ever refused) instead of a live DB
// round-trip on garbage, and closes the filter-syntax hazard.
const COPILOT_ID_RE = /^[a-z0-9-]{1,200}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Upstream TIMEOUT detection: postgrest.ts aborts any round-trip past 30s and
// rethrows it as a PgrestError carrying `status: 504` (commit 10c01f9); the
// Agent Server SDK's HTTPError carries the upstream status the same way. A
// timeout surfaces as HTTP 504 (gateway timeout) instead of the generic 502 so
// the caller can tell "backend hung" from "backend errored". Duck-typed on
// `.status` — same pattern as isNotFoundError in agent-builder-run.ts
// (PgrestError is not exported from postgrest.ts).
const isUpstreamTimeout = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && 'status' in err && (err as { status: unknown }).status === 504

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
 *   5. ATOMICALLY claim the run: PATCH it to `running` conditioned on
 *      `status=eq.needs-confirmation` (a compare-and-swap on the DB row) and
 *      require the update to have matched a row. This closes the race where
 *      two concurrent resume calls (or a resume racing a delete) both pass the
 *      step-3 read and both proceed to resume the SAME Agent Server thread —
 *      only the request that wins the claim continues; the loser gets a clean
 *      409 before any side effect. Also doubles as the TOCTOU guard for the
 *      run being deleted between step 3 and here (0 rows matched → 404).
 *   6. Resume on the Agent Server with the decision.
 *   7. Append the resumed steps (continuing the run's index) + tool_calls, then
 *      either:
 *        - the resume hit ANOTHER gated tool (re-interrupted) → PATCH back to
 *          `needs-confirmation`, finished_at stays null, thread_id untouched —
 *          same non-terminal shape as the original run's pending approval
 *          (runner.ts), and the response carries `interrupted`/
 *          `interruptMessage`/`pendingTool` so the operator can approve again.
 *        - otherwise → PATCH the run to `completed`/`failed`/`blocked`,
 *          stamping output_summary + finished_at (terminal).
 *
 * Live-only: never fabricates a resume — a resume/persist failure surfaces as
 * 502 (504 when the upstream call timed out).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ copilotId: string; runId: string }> }
) {
  const { copilotId, runId } = await params

  if (!COPILOT_ID_RE.test(copilotId)) {
    return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })
  }
  if (!UUID_RE.test(runId)) {
    return NextResponse.json({ error: 'invalid runId' }, { status: 400 })
  }

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
    console.error('[agent-ops/runs/resume] failed to load run', err)
    return NextResponse.json({ error: 'failed to load run' }, { status: isUpstreamTimeout(err) ? 504 : 502 })
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

  // Atomically claim the run BEFORE doing any work: flip it to `running`
  // conditioned on it STILL being `needs-confirmation` (compare-and-swap via
  // the PostgREST WHERE clause). This is the single source of truth for
  // "who gets to resume this run" — the read above is just an early exit for
  // the common case; a concurrent second resume call (double-submit) or a
  // delete racing this request must not both proceed past this point.
  // `Prefer: return=representation` means an empty array back means the
  // WHERE clause matched nothing: either another request already claimed it
  // (lost the race → 409) or the run vanished entirely (deleted → 404).
  try {
    const claimed = await pgrest<Record<string, unknown>[]>(
      'PATCH',
      `agent_runs?id=eq.${encodeURIComponent(runId)}&status=eq.needs-confirmation`,
      { status: 'running' }
    )
    if (claimed.length === 0) {
      // Distinguish "gone" from "already claimed" with one more read — best
      // effort, not required for correctness (either way the caller cannot
      // proceed), but it gives an honest status code instead of guessing.
      let stillExists = true
      try {
        const check = await pgrest<Record<string, unknown>[]>(
          'GET',
          `agent_runs?id=eq.${encodeURIComponent(runId)}&select=id`
        )
        stillExists = check.length > 0
      } catch {
        // Non-fatal — fall through with the optimistic assumption below.
      }
      return stillExists
        ? NextResponse.json({ error: 'run is not awaiting confirmation' }, { status: 409 })
        : NextResponse.json({ error: 'run not found' }, { status: 404 })
    }
  } catch (err) {
    console.error('[agent-ops/runs/resume] failed to claim run', err)
    return NextResponse.json({ error: 'failed to claim run' }, { status: isUpstreamTimeout(err) ? 504 : 502 })
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

  // Resolve the run assistant so the resume targets the SAME assistant the run
  // started on. Shared cascade (same helper as runner/test-runner): the copilot's
  // OWN assistant (0009) first, then the project's assistant (0008), then
  // undefined → shared graph id inside resumeOnAgentServer. Non-fatal: a lookup
  // failure just falls back to the shared graph id.
  let assistantId: string | undefined
  try {
    assistantId = await resolveRunAssistantId(copilotId)
  } catch {
    // Fall back to the shared graph id below.
  }

  // Resolve the SAME step budget the original run used (via version_id →
  // manifest_id → max_steps_per_run, mirroring run/route.ts) so the resume's
  // recursion_limit matches the copilot's configured budget instead of
  // silently falling back to the SDK's unrelated default (25 — see
  // recursionLimitFor in langgraph-server.ts). Non-fatal: any lookup failure
  // just keeps the default, same posture as the assistantId resolution above.
  let maxStepsPerRun = DEFAULT_MAX_STEPS_PER_RUN
  try {
    const versionId = runRow.version_id as string | null
    if (versionId) {
      const versionRows = await pgrest<Record<string, unknown>[]>(
        'GET',
        `copilot_versions?id=eq.${encodeURIComponent(versionId)}&select=manifest_id`
      )
      const manifestId = versionRows[0]?.manifest_id as string | null
      if (manifestId) {
        const manifestRows = await pgrest<Record<string, unknown>[]>(
          'GET',
          `manifests?id=eq.${encodeURIComponent(manifestId)}&select=max_steps_per_run`
        )
        const rawMaxSteps = manifestRows[0]?.max_steps_per_run
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
  } catch {
    // Non-fatal — keep DEFAULT_MAX_STEPS_PER_RUN.
  }

  // 2) Continue the thread with the operator's decision, then persist the
  //    resumed steps/tool calls and close the run. Any failure here is a 502.
  // True once the Agent Server resumed the thread to a TERMINAL state (not a
  // re-interrupt) — drives the catch block's claim cleanup: a thread that ran
  // to completion can never be resumed again, one that didn't still can.
  let threadRanToCompletion = false
  try {
    const result = await resumeOnAgentServer({ threadId, approved, assistantId, maxSteps: maxStepsPerRun })
    threadRanToCompletion = !result.interrupted

    // Continue the run's step numbering from the max existing index + 1.
    const lastStepRows = await pgrest<Record<string, unknown>[]>(
      'GET',
      `agent_run_steps?run_id=eq.${encodeURIComponent(runId)}&select=index&order=index.desc&limit=1`
    )
    const nextIndex =
      typeof lastStepRows[0]?.index === 'number' ? (lastStepRows[0].index as number) + 1 : 0

    // Append the resumed steps in ONE bulk insert (LangGraphServerStep kinds
    // are already DB-valid) — a per-row POST loop would be N sequential
    // round-trips to the gpu1 perimeter for rows all known up front.
    if (result.steps.length > 0) {
      const startedAt = new Date().toISOString()
      await pgrest(
        'POST',
        'agent_run_steps',
        result.steps.map((step, i) => ({
          id: randomUUID(),
          run_id: runId,
          index: nextIndex + i,
          kind: step.kind,
          title: step.title,
          detail: step.detail,
          status: step.status,
          started_at: startedAt,
          duration_ms: 0,
          tool_call_id: null,
        }))
      )
    }

    // Append the resumed tool calls with the REAL tool_id/risk/confirmation —
    // same single bulk insert.
    if (result.toolCalls.length > 0) {
      await pgrest(
        'POST',
        'tool_calls',
        result.toolCalls.map((tc) => {
          const dbTool = toolByName.get(tc.toolName)
          return {
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
          }
        })
      )
    }

    // Re-aggregate the run's counters from the full tool_calls table so
    // tool_call_count / unsafe_attempt_count reflect the resumed rows (they were
    // 0 at pause). Re-read after the inserts above — needed for BOTH the
    // re-interrupted and terminal branches below.
    const allCalls = await pgrest<Record<string, unknown>[]>(
      'GET',
      `tool_calls?run_id=eq.${encodeURIComponent(runId)}&select=status`
    )
    const toolCallCount = allCalls.length
    const unsafeAttemptCount = allCalls.filter((c) => c.status === 'blocked').length

    // Re-interrupted during resume: the graph called ANOTHER gated tool right
    // after this one was approved (same runs.wait, new interrupt()). This is
    // NOT a terminal outcome — mirror EXACTLY how the original run persists a
    // pending approval (runner.ts:430-488): status 'needs-confirmation',
    // finished_at left null (not "finished", still awaiting a human decision),
    // thread_id untouched (already correct — this route never overwrote it).
    // Checked FIRST, before the terminal status logic below, so a fresh
    // interrupt can never be mis-scored as completed/failed/blocked from stale
    // toolCalls/budgetExhausted reasoning that assumed the run had ended.
    if (result.interrupted) {
      const outputSummary = summarize(result.interruptMessage ?? 'Awaiting human approval for a tool call.')
      await pgrest('PATCH', `agent_runs?id=eq.${encodeURIComponent(runId)}`, {
        status: 'needs-confirmation',
        output_summary: outputSummary,
        finished_at: null,
        tool_call_count: toolCallCount,
        unsafe_attempt_count: unsafeAttemptCount,
      })

      return NextResponse.json({
        ok: true,
        runId,
        status: 'needs-confirmation',
        outputSummary,
        approved,
        interrupted: true,
        interruptMessage: result.interruptMessage,
        pendingTool: result.pendingTool ?? null,
      })
    }

    // Four outcomes, not two:
    //   - the graph hit its own maxSteps guard after resuming (structured
    //     marker, same as the original run path in runner.ts) → `failed`.
    //     The task was NOT finished — reporting `completed` here would be
    //     exactly the lie this route exists to avoid. Checked FIRST: a
    //     budget-exhausted resume must not be masked by the blocked-tool-call
    //     logic below (the graph can exhaust its budget with no tool calls
    //     blocked at all).
    //   - every tool call blocked AND the operator rejected  → `blocked`
    //     (the expected, safe outcome of a decline).
    //   - every tool call blocked AND the operator APPROVED   → `failed`
    //     (the human said yes, but the tool never ran/succeeded — an
    //     approval whose action fails is a failure, not a success; reporting
    //     `completed` here would tell the operator "approved, done" while
    //     the action silently didn't happen).
    //   - otherwise (at least one tool call actually went through)  → `completed`.
    const allBlocked =
      result.toolCalls.length > 0 && result.toolCalls.every((tc) => tc.status === 'blocked')
    const status = result.budgetExhausted
      ? 'failed'
      : allBlocked
        ? (approved ? 'failed' : 'blocked')
        : 'completed'
    const outputSummary = summarize(result.finalText || '(empty response)')

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
      // The run is unrecoverable: it can never be resumed, so it must stop
      // reporting `needs-confirmation` forever. Close it out as `failed` (no
      // 'abandoned'/'expired' value exists in the agent_runs status CHECK —
      // see supabase/migrations/0001_agent_mission_control.sql:142) with an
      // honest output_summary and a finished_at stamp, so it drops out of
      // "awaiting approval" views and duration metrics. Best-effort: a
      // failure to close it must not hide the actionable 409 below.
      try {
        await pgrest('PATCH', `agent_runs?id=eq.${encodeURIComponent(runId)}`, {
          status: 'failed',
          output_summary:
            'The approval thread was lost because the Agent Server restarted (in-memory thread state). ' +
            'This run can never be resumed — relaunch it.',
          finished_at: new Date().toISOString(),
        })
      } catch {
        // Non-fatal — the 409 below still tells the client the thread is lost.
      }
      return NextResponse.json(
        { error: 'the approval thread was lost (Agent Server restarted) — relaunch the run', threadLost: true },
        { status: 409 }
      )
    }
    // The run was claimed (`running`) at step 5 and NOTHING else ever
    // transitions that row — a generic failure must not leave it stuck in
    // `running` forever (every resume retry would 409 against the claim).
    // Best-effort, mirroring the thread-lost close-out above:
    //   - the thread did NOT run to completion (resume call failed, or it
    //     re-interrupted and persisting that failed) → its approval is still
    //     pending: hand the claim back (`needs-confirmation`) so the operator
    //     can retry.
    //   - the thread DID run to completion but persisting the outcome failed →
    //     it can never be resumed again: close it out honestly as `failed`.
    try {
      await pgrest(
        'PATCH',
        `agent_runs?id=eq.${encodeURIComponent(runId)}`,
        threadRanToCompletion
          ? {
              status: 'failed',
              output_summary:
                'The thread resumed but its outcome could not be persisted — check the run trace on the Agent Server.',
              finished_at: new Date().toISOString(),
            }
          : { status: 'needs-confirmation' }
      )
    } catch {
      // Non-fatal — the 502 below still tells the client the resume failed.
    }
    // Never forward the raw error text to the client: it can carry Agent
    // Server/internal detail. Log server-side, generic message to the caller
    // (same convention as architect/resume, builder/resume, create-draft).
    console.error('[agent-ops/runs/resume] resume failed', err)
    return NextResponse.json({ error: 'run resume failed' }, { status: isUpstreamTimeout(err) ? 504 : 502 })
  }
}
