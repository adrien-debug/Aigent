import { NextResponse } from 'next/server'

import { getAvailableAgents, summarizeAvailableAgents } from '@/lib/agent-mission-control/available-agents'
import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'

/**
 * GET /api/agent-ops/agents — the canonical runtime catalogue of available
 * agents, and the ONLY one. Every entry is a provisioned copilot read from the
 * live perimeter; there is no static list, no fixture, no seed and no demo
 * entry behind this route, and no fallback if the backend is down.
 *
 * AUTH: enforced upstream by src/proxy.ts for every `/api/agent-ops/**` path —
 * this handler adds no second gate on purpose (duplicated gates drift).
 *
 * READ-ONLY. No write path, no LLM call, no secret in the response.
 *
 * Status contract — repo-wide convention (see projects/[id]/team/route.ts):
 *   502 upstream failed at request time
 *   503 live backend not configured — a deployment state, NOT an empty catalogue
 *   504 PostgREST timeout
 *
 * The 503 matters: an unconfigured environment must say so, because the
 * alternative — answering `{agents: []}` — is indistinguishable from a real
 * environment that genuinely has no agents, and that ambiguity is exactly how
 * a fallback catalogue gets reintroduced "to have something to show".
 */

function envReady(): boolean {
  return (
    process.env.AMC_DATA_SOURCE === 'gpu1' &&
    Boolean(process.env.AMC_SUPABASE_URL) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  )
}

export async function GET() {
  if (!envReady()) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  try {
    const agents = await getAvailableAgents()
    // Counters come from the served array itself — never a second query, so the
    // summary cannot contradict the list it summarises.
    return NextResponse.json({ agents, summary: summarizeAvailableAgents(agents) })
  } catch (err) {
    // Full error server-side only — the thrown message can carry PostgREST internals.
    console.error('[agent-ops/agents] catalogue load failed:', err)
    if (isPgrestTimeout(err)) {
      return NextResponse.json({ error: 'agent catalogue timed out' }, { status: 504 })
    }
    return NextResponse.json({ error: 'agent catalogue unavailable' }, { status: 502 })
  }
}
