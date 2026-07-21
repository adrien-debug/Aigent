import { NextResponse } from 'next/server'

import { getAvailableAgent } from '@/lib/agent-mission-control/available-agents'
import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'

/**
 * GET /api/agent-ops/agents/:copilotId — one agent from the canonical
 * catalogue, or 404.
 *
 * The 404 is the point: an id that no persisted copilot row carries is
 * REFUSED. There is no manifest lookup, no fixture lookup and no "close
 * enough" match to fall back on, so a fabricated id cannot be answered with a
 * plausible-looking agent.
 *
 * AUTH: enforced upstream by src/proxy.ts. READ-ONLY.
 *
 * Status contract:
 *   400 malformed id      404 unknown id
 *   502 upstream failed   503 backend not configured   504 timeout
 */

/** Same shape the sibling copilots/[copilotId] routes gate on. */
const COPILOT_ID_RE = /^[a-z0-9-]{1,200}$/

function envReady(): boolean {
  return (
    process.env.AMC_DATA_SOURCE === 'gpu1' &&
    Boolean(process.env.AMC_SUPABASE_URL) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  )
}

export async function GET(_request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params

  if (!COPILOT_ID_RE.test(copilotId)) {
    return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })
  }

  if (!envReady()) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  try {
    const agent = await getAvailableAgent(copilotId)
    if (agent === undefined) {
      return NextResponse.json({ error: 'agent not found' }, { status: 404 })
    }
    return NextResponse.json({ agent })
  } catch (err) {
    console.error('[agent-ops/agents/:id] agent load failed:', err)
    if (isPgrestTimeout(err)) {
      return NextResponse.json({ error: 'agent lookup timed out' }, { status: 504 })
    }
    return NextResponse.json({ error: 'agent lookup unavailable' }, { status: 502 })
  }
}
