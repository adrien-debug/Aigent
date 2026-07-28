import { NextResponse } from 'next/server'

import { markAgentDraftMaterialized } from '@/lib/agent-mission-control/agent-drafts-store'
import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'

const ID_RE = /^[a-z0-9-]{1,200}$/

function liveBackendMissing(): boolean {
  return (
    process.env.AMC_DATA_SOURCE !== 'gpu1' ||
    !process.env.AMC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

/**
 * PATCH /api/agent-ops/agent-drafts/:draftId — link a persisted draft to the
 * copilot that materialized it.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const { draftId } = await params
  if (!ID_RE.test(draftId)) {
    return NextResponse.json({ error: 'invalid draftId' }, { status: 400 })
  }
  if (liveBackendMissing()) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })
    }
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const copilotId = body.copilotId
  if (typeof copilotId !== 'string' || !ID_RE.test(copilotId)) {
    return NextResponse.json({ error: 'copilotId is required' }, { status: 400 })
  }

  try {
    await markAgentDraftMaterialized(draftId, copilotId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[agent-ops/agent-drafts] materialize failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: 'failed to update draft' },
      { status: isPgrestTimeout(err) ? 504 : 502 },
    )
  }
}
