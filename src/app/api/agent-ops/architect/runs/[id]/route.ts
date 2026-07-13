import { NextResponse } from 'next/server'

import { getAgentBuilderRunState } from '@/lib/agent-mission-control/agent-builder-run'

/**
 * GET /api/agent-ops/architect/runs/:id — read the current state of an Agent
 * Builder run from its LangGraph thread (the Agent Server is the source of
 * truth — it owns the thread's checkpointed state).
 *
 * Returns the normalized BuilderRunState (events, manifestDraft, selectedTools,
 * testCases, risks, approvalRequired, …). 404 when the thread is unknown (e.g.
 * the dev Agent Server was restarted and dropped its in-memory threads).
 *
 * Auth: enforced by src/proxy.ts. Fail-closed 503 without the Agent Server
 * configured. Read-only — never mutates the run.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  if (process.env.AMC_DATA_SOURCE !== 'gpu1') {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  try {
    const state = await getAgentBuilderRunState(id)
    if (!state) {
      return NextResponse.json(
        { error: 'run not found (thread unknown — the Agent Server may have restarted)', threadLost: true },
        { status: 404 }
      )
    }
    return NextResponse.json(state)
  } catch (err) {
    console.error('[agent-ops/architect/runs] failed to read run state', err)
    return NextResponse.json({ error: 'failed to read run state' }, { status: 502 })
  }
}
