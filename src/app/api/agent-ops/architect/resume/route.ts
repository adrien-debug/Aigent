import { NextResponse } from 'next/server'

import { AGENT_BUILDER_SLUG } from '@/lib/agent-mission-control/agent-builder-copilot'
import { resumeAgentBuilderRun, draftToCreateInput } from '@/lib/agent-mission-control/agent-builder-run'
import { createCopilotFromManifest } from '@/lib/agent-mission-control/authoring-writes'
import { pgrest } from '@/lib/agent-mission-control/postgrest'

/**
 * POST /api/agent-ops/architect/resume — the human-in-the-loop decision for a
 * paused Agent Builder run.
 *
 * Body: { runId: string, approved: boolean }
 *
 * On APPROVE: the graph's gated `draft_copilot_spec` tool runs (producing the
 * proposal), and — because the human approved — this route PERSISTS that
 * proposal as a REAL draft copilot on the validation bench (status 'draft',
 * project_id null). That persisted copilot is the approved side-effect, written
 * through the same authoring write path any user-authored copilot uses. It is
 * NEVER promoted to production and never assigned to a project.
 *
 * On REJECT: the gated tool is blocked, nothing is created, and the run ends
 * `blocked`.
 *
 * Auth: enforced by src/proxy.ts. Fail-closed 503 without the gpu1 backend +
 * OPENAI_API_KEY. Never fabricates a resume, never creates on reject.
 */

export async function POST(request: Request) {
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  let body: { runId?: unknown; approved?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (typeof body.runId !== 'string' || body.runId.trim().length === 0) {
    return NextResponse.json({ error: 'runId is required' }, { status: 400 })
  }
  if (typeof body.approved !== 'boolean') {
    return NextResponse.json({ error: 'approved must be a boolean' }, { status: 400 })
  }
  const { runId, approved } = body

  // Resolve the Agent Builder copilot (the assistant the run started on).
  let copilotId: string
  try {
    const rows = await pgrest<{ id: string }[]>(
      'GET',
      `copilots?select=id&slug=eq.${encodeURIComponent(AGENT_BUILDER_SLUG)}&limit=1`
    )
    if (!rows[0]) {
      return NextResponse.json({ error: 'Agent Builder is not provisioned' }, { status: 409 })
    }
    copilotId = rows[0].id
  } catch (err) {
    console.error('[agent-ops/architect/resume] failed to resolve Agent Builder', err)
    return NextResponse.json({ error: 'failed to resolve Agent Builder' }, { status: 502 })
  }

  let state
  try {
    state = await resumeAgentBuilderRun({ copilotId, runId, approved })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'resume failed'
    // The dev Agent Server keeps thread state in memory; a restart drops it and
    // resuming a lost thread 404s. Surface that as an actionable 409.
    if (/\b404\b|not found/i.test(message)) {
      return NextResponse.json(
        { error: 'the approval thread was lost (Agent Server restarted) — relaunch the run', threadLost: true },
        { status: 409 }
      )
    }
    console.error('[agent-ops/architect/resume] resume failed', err)
    return NextResponse.json({ error: 'Agent Builder resume failed' }, { status: 502 })
  }

  // On reject (or no draft produced), return the run state as-is — nothing created.
  if (!approved || !state.manifestDraft) {
    return NextResponse.json(state)
  }

  // APPROVED + a draft exists → persist it as a real draft copilot on the bench.
  // This is the approved side-effect: a materialized draft the operator can then
  // inspect, test and (separately, later, with its own approval) promote.
  try {
    const createInput = draftToCreateInput(state.manifestDraft, state.selectedTools)
    const createdCopilotId = await createCopilotFromManifest(createInput)
    return NextResponse.json({ ...state, createdCopilotId })
  } catch (err) {
    // The draft was approved but persistence failed — report it honestly rather
    // than claiming a copilot was created. The run itself succeeded.
    console.error('[agent-ops/architect/resume] draft persistence failed', err)
    return NextResponse.json(
      { ...state, createdCopilotId: null, persistError: 'the draft was approved but could not be saved — retry' },
      { status: 502 }
    )
  }
}
