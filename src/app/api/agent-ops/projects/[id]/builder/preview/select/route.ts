import { NextResponse } from 'next/server'

import { getProject } from '@/lib/agent-mission-control/data'
import { selectProjectBuilderPreviewOption } from '@/lib/agent-mission-control/project-builder-conversation'

/**
 * POST /api/agent-ops/projects/:id/builder/preview/select
 * Select an A/B/C preview option before draft materialization.
 */
const PROJECT_ID_RE = /^[a-z0-9-]{1,200}$/
/** Option ids are short LLM-generated slugs (A/B/C…) — bound before persisting to DB. */
const MAX_OPTION_ID_LENGTH = 200

function requireLiveBackend(): NextResponse | null {
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
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

  let body: { optionId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (typeof body.optionId !== 'string' || body.optionId.trim().length === 0) {
    return NextResponse.json({ error: 'optionId is required' }, { status: 400 })
  }
  if (body.optionId.length > MAX_OPTION_ID_LENGTH) {
    return NextResponse.json({ error: `optionId exceeds ${MAX_OPTION_ID_LENGTH} characters` }, { status: 400 })
  }

  // selectProjectBuilderPreviewOption goes through
  // ensureActiveProjectBuilderConversation, which CREATES a conversation row
  // when none exists — an unknown project id must 404 here, otherwise it
  // persists a ghost conversation (or trips the project_id FK → opaque 502).
  // Same pre-check as the sibling builder/conversation and builder/message
  // routes.
  try {
    if (!(await getProject(id))) {
      return NextResponse.json({ error: 'project not found' }, { status: 404 })
    }
  } catch (err) {
    console.error('[agent-ops/projects/builder/preview/select] failed to check project', err)
    return NextResponse.json({ error: 'failed to check project' }, { status: 502 })
  }

  try {
    const bundle = await selectProjectBuilderPreviewOption(id, body.optionId.trim())
    return NextResponse.json(bundle)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'select failed'
    if (/not found/i.test(message)) {
      // Fixed literal — never echo err.message to the client.
      return NextResponse.json({ error: 'preview option not found' }, { status: 404 })
    }
    console.error('[agent-ops/projects/builder/preview/select] POST failed', err)
    return NextResponse.json({ error: 'preview select failed' }, { status: 502 })
  }
}
