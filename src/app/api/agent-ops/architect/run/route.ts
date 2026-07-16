import { NextResponse } from 'next/server'

import { AGENT_BUILDER_SLUG } from '@/lib/agent-mission-control/agent-builder-copilot'
import { startAgentBuilderRun } from '@/lib/agent-mission-control/agent-builder-run'
import { isPgrestTimeout, pgrest } from '@/lib/agent-mission-control/postgrest'

/**
 * POST /api/agent-ops/architect/run — start a REAL Agent Builder run.
 *
 * Runs the Agent Builder Copilot's LangGraph graph on the official Agent Server
 * (understand → draft → tools → tests → risk review → human-approval interrupt).
 * The graph PAUSES at `draft_copilot_spec` (confirmation-required) BEFORE any
 * draft is produced, so a run that reaches the draft step returns
 * `status: 'awaiting_approval'` and NOTHING is created until the operator
 * approves via /architect/resume.
 *
 * Body: { userInput: string }
 * Returns the normalized BuilderRunState (runId is the resumable thread id).
 *
 * Auth: enforced by src/proxy.ts (session OR x-amc-key) before this handler.
 * Fail-closed 503 without the gpu1 backend + OPENAI_API_KEY. Never mocks a run.
 */

const MAX_USER_INPUT_LENGTH = 32_000

export async function POST(request: Request) {
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  let body: { userInput?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (typeof body.userInput !== 'string' || body.userInput.trim().length === 0) {
    return NextResponse.json({ error: 'userInput is required' }, { status: 400 })
  }
  if (body.userInput.length > MAX_USER_INPUT_LENGTH) {
    return NextResponse.json(
      { error: `userInput exceeds the ${MAX_USER_INPUT_LENGTH}-character limit` },
      { status: 400 }
    )
  }
  const userInput = body.userInput

  // Resolve the Agent Builder copilot by its stable slug (its row id carries a
  // random suffix). 409 if it hasn't been provisioned yet — the client should
  // POST /copilots/provision-agent-builder first.
  let copilotId: string
  try {
    const rows = await pgrest<{ id: string }[]>(
      'GET',
      `copilots?select=id&slug=eq.${encodeURIComponent(AGENT_BUILDER_SLUG)}&limit=1`
    )
    if (!rows[0]) {
      return NextResponse.json(
        { error: 'Agent Builder is not provisioned — POST /api/agent-ops/copilots/provision-agent-builder first', notProvisioned: true },
        { status: 409 }
      )
    }
    copilotId = rows[0].id
  } catch (err) {
    console.error('[agent-ops/architect/run] failed to resolve Agent Builder', err)
    // pgrest() aborts a hung PostgREST round-trip and rethrows PgrestError(504)
    // — surface that as an honest 504 Gateway Timeout; any other upstream
    // failure stays a generic 502. Same body shape either way.
    return NextResponse.json({ error: 'failed to resolve Agent Builder' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }

  try {
    const state = await startAgentBuilderRun({ copilotId, userInput })
    return NextResponse.json(state)
  } catch (err) {
    // The Agent Server / OpenAI errors can carry internal detail — never forward.
    console.error('[agent-ops/architect/run] run failed', err)
    return NextResponse.json({ error: 'Agent Builder run failed' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
}
