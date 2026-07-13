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

  let body: { approved?: unknown }
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
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
    console.error('[agent-ops/projects/builder/create-draft] POST failed', err)
    return NextResponse.json({ error: 'create draft failed' }, { status: 502 })
  }
}
