import { NextResponse } from 'next/server'

import {
  postProjectBuilderMessage,
  postProjectBuilderMessageStream,
} from '@/lib/agent-mission-control/project-builder-conversation'

/**
 * POST /api/agent-ops/projects/:id/builder/message
 * Persist user turn, run architect LLM, persist assistant reply + preview update.
 *
 * Two transports, same underlying write path:
 *  - Default (no streaming requested): behaves exactly as before — runs the
 *    full architect turn, then returns the complete bundle as JSON.
 *  - Streaming (`Accept: text/event-stream` header OR `?stream=1` query):
 *    returns a `text/event-stream` response. Each prose token the architect
 *    produces is pushed as `data: {"delta":"..."}\n\n` as soon as it arrives;
 *    a final `data: {"done":true,"preview":...,"messageId":...}\n\n` event
 *    carries the same data the JSON endpoint would have returned in one shot
 *    (resolved preview + latest assistant message id), so the client can
 *    reconcile without a second round-trip. Persistence is identical either
 *    way — the SSE transport does not change what gets written to the DB,
 *    only how the prose is delivered to the browser while it is generated.
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

function wantsStream(request: Request): boolean {
  const accept = request.headers.get('accept') ?? ''
  if (accept.includes('text/event-stream')) return true
  const url = new URL(request.url)
  return url.searchParams.get('stream') === '1'
}

function sseEvent(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`
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
  const content = body.content

  if (!wantsStream(request)) {
    try {
      const bundle = await postProjectBuilderMessage(id, content)
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

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (payload: Record<string, unknown>) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(sseEvent(payload)))
        } catch {
          // Controller already closed client-side (e.g. aborted) — ignore.
        }
      }

      try {
        const bundle = await postProjectBuilderMessageStream(id, content, (delta) => {
          push({ delta })
        })
        const latestAssistant = [...bundle.messages].reverse().find((m) => m.role === 'assistant') ?? null
        push({
          done: true,
          preview: bundle.conversation.latestPreview,
          conversationStatus: bundle.conversation.status,
          createdCopilotId: bundle.createdCopilotId,
          messageId: latestAssistant?.id ?? null,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'message failed'
        console.error('[agent-ops/projects/builder/message] stream failed', err)
        push({ error: /already produced a draft/i.test(message) ? message : 'architect message failed' })
      } finally {
        closed = true
        controller.close()
      }
    },
    cancel() {
      closed = true
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
