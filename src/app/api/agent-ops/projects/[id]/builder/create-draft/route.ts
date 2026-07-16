import { NextResponse } from 'next/server'

import {
  confirmProjectBuilderDraftMaterialization,
  getProjectBuilderConversationBundle,
  startProjectBuilderDraftMaterialization,
} from '@/lib/agent-mission-control/project-builder-conversation'
import { canStartDraftMaterialization } from '@/lib/agent-mission-control/project-builder-preview'

/**
 * POST /api/agent-ops/projects/:id/builder/create-draft
 *
 * Two-step draft materialization (reuses validated LangGraph pipeline):
 * - No `approved` field + preview.readyForApproval → start LangGraph run (HITL interrupt).
 * - With `approved: boolean` + langgraph_thread_id on conversation → confirm/reject.
 *
 * No GitHub write. Draft only after explicit approval gates.
 */
const PROJECT_ID_RE = /^[a-z0-9-]{1,200}$/

function requireLiveBackend(): NextResponse | null {
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }
  return null
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!PROJECT_ID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  const blocked = requireLiveBackend()
  if (blocked) return blocked

  // Absent/unparseable body is a VALID start request (the start step takes no
  // fields), so it normalizes to {} instead of 400ing like sibling routes. But
  // `request.json()` can also resolve to null/array/primitive — normalize those
  // to {} too (a raw `null` body used to TypeError into the 502 catch), and
  // reject a present-but-non-boolean `approved` (e.g. "true") instead of
  // silently falling through to the START path and launching a new run when
  // the client meant to confirm — mirrors resume/route.ts's guard.
  let body: { approved?: unknown } = {}
  try {
    const parsed: unknown = await request.json()
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      body = parsed as { approved?: unknown }
    }
  } catch {
    // No body / invalid JSON → start step.
  }
  if (body.approved !== undefined && typeof body.approved !== 'boolean') {
    return NextResponse.json({ error: 'approved must be a boolean' }, { status: 400 })
  }

  try {
    const bundle = await getProjectBuilderConversationBundle(id)
    const conversation = bundle.conversation

    if (typeof body.approved === 'boolean') {
      if (!conversation.langgraphThreadId) {
        return NextResponse.json({ error: 'no LangGraph run in progress — start draft first' }, { status: 409 })
      }
      const result = await confirmProjectBuilderDraftMaterialization(id, body.approved)
      const updated = await getProjectBuilderConversationBundle(id)
      return NextResponse.json({
        ...updated,
        runState: result.runState,
        createdCopilotId: result.createdCopilotId,
        assistantId: result.assistantId,
      })
    }

    // Double-submission guard: the bundle load above already reconciled
    // `langgraphThreadId` against the Agent Server (stale ids cleared on 404),
    // so a non-null id here means a run is REALLY in progress — answer 409
    // instead of letting startProjectBuilderDraftMaterialization throw into
    // the generic 502 catch on a double-click of "Approve — create draft".
    if (conversation.langgraphThreadId) {
      return NextResponse.json(
        { error: 'draft materialization already in progress — confirm or reject it' },
        { status: 409 }
      )
    }

    const guard = canStartDraftMaterialization(conversation.latestPreview)
    if (!guard.ok) {
      return NextResponse.json({ error: guard.reason }, { status: 409 })
    }

    const { runState } = await startProjectBuilderDraftMaterialization(id)
    const updated = await getProjectBuilderConversationBundle(id)
    return NextResponse.json({
      ...updated,
      runState,
      createdCopilotId: null,
      assistantId: null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'create draft failed'
    if (/404|not found|thread was lost/i.test(message)) {
      return NextResponse.json(
        { error: 'the approval thread was lost — restart draft materialization', threadLost: true },
        { status: 409 }
      )
    }
    // TOCTOU backup for the pre-check above: two concurrent start requests can
    // both pass the guard; the loser's internal throw is a conflict, not a 502.
    if (/already in progress/i.test(message)) {
      return NextResponse.json(
        { error: 'draft materialization already in progress — confirm or reject it' },
        { status: 409 }
      )
    }
    console.error('[agent-ops/projects/builder/create-draft] POST failed', err)
    return NextResponse.json({ error: 'create draft failed' }, { status: 502 })
  }
}
