import { NextResponse } from 'next/server'

import { postProjectBuilderMessage } from '@/lib/agent-mission-control/project-builder-conversation'

/**
 * POST /api/agent-ops/projects/:id/builder/message
 * Persist user turn, run architect LLM, persist assistant reply + preview update.
 */
const PROJECT_ID_RE = /^[a-z0-9-]{1,200}$/
const MAX_MESSAGE_LENGTH = 12_000

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

  let body: { content?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (typeof body.content !== 'string' || body.content.trim().length === 0) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }
  if (body.content.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: `content exceeds ${MAX_MESSAGE_LENGTH} characters` }, { status: 400 })
  }

  try {
    const bundle = await postProjectBuilderMessage(id, body.content)
    return NextResponse.json(bundle)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'message failed'
    if (/already produced a draft/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    console.error('[agent-ops/projects/builder/message] POST failed', err)
    return NextResponse.json({ error: 'architect message failed' }, { status: 502 })
  }
}
