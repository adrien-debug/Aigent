import { NextResponse } from 'next/server'

import { getOpenAIClient, ARCHITECT_MODEL } from '@/lib/agent-mission-control/llm-client'
import { ARCHITECT_SYSTEM_PROMPT, ARCHITECT_TOOL } from '@/lib/agent-mission-control/architect-prompt'
import type { ArchitectMessage, GeneratedManifest } from '@/lib/agent-mission-control/authoring-types'

/**
 * POST /api/agent-ops/architect — the Architect assistant.
 *
 * Conversational endpoint backing the agent-authoring surface: takes the
 * running conversation, calls OpenAI with the `emit_manifest` tool wired in,
 * and returns the assistant's reply plus a structured `GeneratedManifest`
 * whenever the model decides the design is ready to propose.
 *
 * Live-only, fail-closed: without `OPENAI_API_KEY` or with
 * `AMC_DATA_SOURCE !== 'gpu1'`, refuse with 503 rather than fake a response.
 * This makes a REAL call to the OpenAI API (costs credits) — authorized
 * per task brief.
 *
 * Server-only: never expose OPENAI_API_KEY to the client.
 */

interface ArchitectRequestBody {
  messages: ArchitectMessage[]
  draftId?: string
}

// Hard caps on the inbound conversation so a malformed/abusive payload can't
// be forwarded straight into a paid OpenAI call: an unbounded message count
// or unbounded per-message content would still pass the shape checks below
// (array of {role, content:string}) while blowing up token cost/latency, or
// in the extreme tying up server memory building the request body.
const MAX_MESSAGES = 200
const MAX_MESSAGE_CONTENT_LENGTH = 32_000

// Per-call timeout for the OpenAI request. The SDK's own default (10 minutes,
// see openai/client.d.ts) is far longer than an interactive chat endpoint
// should ever hold a request open for — without this, a slow/hung upstream
// leaves the route (and the caller) blocked well past any reasonable budget.
const OPENAI_REQUEST_TIMEOUT_MS = 60_000

interface ArchitectResponseBody {
  reply: string
  manifest: GeneratedManifest | null
}

export async function POST(request: Request) {
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  let body: ArchitectRequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: 'messages must be a non-empty array' }, { status: 400 })
  }
  if (body.messages.length > MAX_MESSAGES) {
    return NextResponse.json(
      { error: `messages array too large (max ${MAX_MESSAGES})` },
      { status: 400 }
    )
  }
  const invalidMessage = body.messages.some(
    (m) =>
      !m ||
      (m.role !== 'user' && m.role !== 'assistant') ||
      typeof m.content !== 'string' ||
      m.content.length > MAX_MESSAGE_CONTENT_LENGTH
  )
  if (invalidMessage) {
    return NextResponse.json(
      {
        error: `each message must have role "user"|"assistant" and string content (max ${MAX_MESSAGE_CONTENT_LENGTH} chars)`,
      },
      { status: 400 }
    )
  }

  let client: ReturnType<typeof getOpenAIClient>
  try {
    client = getOpenAIClient()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to init OpenAI client' },
      { status: 503 }
    )
  }

  const messages = [
    { role: 'system' as const, content: ARCHITECT_SYSTEM_PROMPT },
    ...body.messages.map((m) => ({ role: m.role, content: m.content })),
  ]

  let response: Awaited<ReturnType<typeof client.chat.completions.create>>
  try {
    response = await client.chat.completions.create(
      {
        model: ARCHITECT_MODEL,
        messages,
        tools: [ARCHITECT_TOOL],
        tool_choice: 'auto',
        max_completion_tokens: 4096,
      },
      { timeout: OPENAI_REQUEST_TIMEOUT_MS }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OpenAI API call failed'
    return NextResponse.json({ error: `OpenAI error: ${message}` }, { status: 502 })
  }

  // Guard the completion shape: an empty `choices` array (rare, but possible on
  // a truncated/filtered response) must surface as a clean 502, not an opaque
  // 500 from dereferencing choices[0].
  const msg = response.choices[0]?.message
  if (!msg) {
    return NextResponse.json({ error: 'OpenAI error: empty completion' }, { status: 502 })
  }
  const replyText = msg.content ?? ''
  // tool_calls is a union (function | custom); narrow on type === 'function'
  // before reading .function so the custom-tool member is excluded.
  const toolCall = msg.tool_calls?.find(
    (t) => t.type === 'function' && t.function.name === 'emit_manifest'
  )
  // The model can emit a truncated/malformed arguments string (e.g. hit the
  // token cap mid-JSON). Parse defensively so that returns a graceful 502
  // rather than throwing an unhandled 500.
  let manifest: GeneratedManifest | null = null
  if (toolCall && toolCall.type === 'function') {
    try {
      manifest = JSON.parse(toolCall.function.arguments) as GeneratedManifest
    } catch {
      return NextResponse.json(
        { error: 'OpenAI error: the model returned a malformed manifest — try again' },
        { status: 502 }
      )
    }
  }

  const payload: ArchitectResponseBody = {
    reply: replyText || (manifest ? "I've drafted a manifest — review it on the right." : ''),
    manifest,
  }
  return NextResponse.json(payload)
}
