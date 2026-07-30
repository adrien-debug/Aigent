import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'

import { getProject } from '@/lib/agent-mission-control/data'
import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'
import {
  postProjectBuilderMessage,
  postProjectBuilderMessageStream,
} from '@/lib/agent-mission-control/project-builder-conversation'
import {
  encodeProjectBuilderHeartbeat,
  encodeProjectBuilderSSE,
  PROJECT_BUILDER_HEARTBEAT_MS,
  type ProjectBuilderStreamEvent,
} from '@/lib/agent-mission-control/project-builder-stream-protocol'

const PROJECT_ID_RE = /^[a-z0-9-]{1,200}$/
const MAX_MESSAGE_LENGTH = 12_000
type ProjectBuilderStreamEventInput =
  ProjectBuilderStreamEvent extends infer Event
    ? Event extends ProjectBuilderStreamEvent
      ? Omit<Event, 'runId' | 'sequence'>
      : never
    : never

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
  return new URL(request.url).searchParams.get('stream') === '1'
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!PROJECT_ID_RE.test(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

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

  try {
    if (!(await getProject(id))) return NextResponse.json({ error: 'project not found' }, { status: 404 })
  } catch (err) {
    console.error('[agent-ops/projects/builder/message] failed to check project', err)
    return NextResponse.json({ error: 'failed to check project' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }

  if (!wantsStream(request)) {
    try {
      return NextResponse.json(await postProjectBuilderMessage(id, content))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'message failed'
      if (/already produced a draft/i.test(message)) {
        return NextResponse.json({ error: message }, { status: 409 })
      }
      console.error('[agent-ops/projects/builder/message] POST failed', err)
      return NextResponse.json({ error: 'architect message failed' }, { status: isPgrestTimeout(err) ? 504 : 502 })
    }
  }

  const encoder = new TextEncoder()
  const runId = randomUUID()
  let sequence = 0
  let closed = false
  let heartbeat: ReturnType<typeof setInterval> | undefined
  // The client hanging up must actually stop the work. Without this the OpenAI
  // turn ran to completion — and kept billing — after the browser was gone.
  const abort = new AbortController()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (frame: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(frame))
        } catch {
          closed = true
        }
      }
      const push = (
        event: ProjectBuilderStreamEventInput
      ) => {
        sequence += 1
        enqueue(encodeProjectBuilderSSE({ ...event, runId, sequence } as ProjectBuilderStreamEvent))
      }

      push({ type: 'connected', lifecycle: 'running', conversationId: null })
      heartbeat = setInterval(() => {
        enqueue(encodeProjectBuilderHeartbeat(runId, sequence))
      }, PROJECT_BUILDER_HEARTBEAT_MS)

      try {
        const bundle = await postProjectBuilderMessageStream(
          id,
          content,
          (delta) => {
            push({ type: 'delta', lifecycle: 'running', conversationId: null, delta })
          },
          abort.signal
        )
        const latestAssistant = bundle.messages.toReversed().find((message) => message.role === 'assistant')
        if (!latestAssistant) throw new Error('persisted assistant message missing')

        push({
          type: 'terminal',
          lifecycle: 'completed',
          conversationId: bundle.conversation.id,
          messageId: latestAssistant.id,
          preview: bundle.conversation.latestPreview,
          conversationStatus: bundle.conversation.status,
          createdCopilotId: bundle.createdCopilotId,
        })
      } catch (err) {
        // A cancelled turn is not a failure: the client is already gone, so
        // there is nobody to receive a terminal frame and nothing to log as an
        // error. Anything else is a real failure and still reports as one.
        if (abort.signal.aborted) {
          console.warn('[agent-ops/projects/builder/message] stream cancelled by client', { runId, sequence })
        } else {
          console.error('[agent-ops/projects/builder/message] stream failed', { runId, sequence, error: err })
          push({
            type: 'terminal',
            lifecycle: 'failed',
            conversationId: null,
            error: 'architect_message_failed',
            retryable: true,
          })
        }
      } finally {
        if (heartbeat) clearInterval(heartbeat)
        if (!closed) {
          closed = true
          controller.close()
        }
      }
    },
    cancel() {
      closed = true
      if (heartbeat) clearInterval(heartbeat)
      // Clearing the heartbeat only stopped the writes. This stops the work.
      abort.abort()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Project-Builder-Run-Id': runId,
    },
  })
}
