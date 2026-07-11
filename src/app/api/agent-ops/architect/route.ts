import { NextResponse } from 'next/server'
import type Anthropic from '@anthropic-ai/sdk'

import { getAnthropicClient, ARCHITECT_MODEL } from '@/lib/agent-mission-control/anthropic-client'
import { ARCHITECT_SYSTEM_PROMPT, ARCHITECT_TOOL } from '@/lib/agent-mission-control/architect-prompt'
import type { ArchitectMessage, GeneratedManifest } from '@/lib/agent-mission-control/authoring-types'

/**
 * POST /api/agent-ops/architect — the Architect assistant.
 *
 * Conversational endpoint backing the agent-authoring surface: takes the
 * running conversation, calls Claude with the `emit_manifest` tool wired in,
 * and returns the assistant's reply plus a structured `GeneratedManifest`
 * whenever the model decides the design is ready to propose.
 *
 * Live-only, fail-closed: without `ANTHROPIC_API_KEY` or with
 * `AMC_DATA_SOURCE !== 'gpu1'`, refuse with 503 rather than fake a response.
 * This makes a REAL call to the Anthropic API (costs credits) — authorized
 * per task brief.
 *
 * Server-only: never expose ANTHROPIC_API_KEY to the client.
 */

interface ArchitectRequestBody {
  messages: ArchitectMessage[]
  draftId?: string
}

interface ArchitectResponseBody {
  reply: string
  manifest: GeneratedManifest | null
}

export async function POST(request: Request) {
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !process.env.ANTHROPIC_API_KEY) {
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
  const invalidMessage = body.messages.some(
    (m) =>
      !m ||
      (m.role !== 'user' && m.role !== 'assistant') ||
      typeof m.content !== 'string'
  )
  if (invalidMessage) {
    return NextResponse.json(
      { error: 'each message must have role "user"|"assistant" and string content' },
      { status: 400 }
    )
  }

  let client: Anthropic
  try {
    client = getAnthropicClient()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to init Anthropic client' },
      { status: 503 }
    )
  }

  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model: ARCHITECT_MODEL,
      max_tokens: 2048,
      system: ARCHITECT_SYSTEM_PROMPT,
      tools: [ARCHITECT_TOOL],
      messages: body.messages.map((m) => ({ role: m.role, content: m.content })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Anthropic API call failed'
    return NextResponse.json({ error: `Anthropic error: ${message}` }, { status: 502 })
  }

  let replyText = ''
  let manifest: GeneratedManifest | null = null

  for (const block of response.content) {
    if (block.type === 'text') {
      replyText += (replyText ? '\n' : '') + block.text
    } else if (block.type === 'tool_use' && block.name === 'emit_manifest') {
      manifest = block.input as GeneratedManifest
    }
  }

  if (!replyText && manifest) {
    replyText = 'Voici le manifeste proposé pour cet agent.'
  }

  const payload: ArchitectResponseBody = { reply: replyText, manifest }
  return NextResponse.json(payload)
}
