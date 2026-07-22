import { NextResponse } from 'next/server'

import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'
import { getPublishedAgents } from '@/lib/agent-mission-control/runtime-catalogue'
import { RUNTIME_CONTRACT_VERSION, requireRuntimeApiAuth } from '@/lib/agent-mission-control/runtime-api-types'

/**
 * GET /api/runtime/v1/agents — the published agent catalogue.
 *
 * Served straight from the canonical derivation, so a consumer sees exactly
 * what the admin catalogue and the run gate see. A consumer must never
 * maintain its own agent list: this endpoint is the single source of truth.
 *
 * Fail-closed. Auth first, before any backend read. If the catalogue cannot be
 * read the answer is 503 — never a partial list, and never a cached guess,
 * because "some agents" is indistinguishable from "these are all the agents".
 */
export async function GET(request: Request) {
  const auth = requireRuntimeApiAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const agents = await getPublishedAgents()
    return NextResponse.json({
      contractVersion: RUNTIME_CONTRACT_VERSION,
      count: agents.length,
      agents,
    })
  } catch (err) {
    // Never forward the upstream text: it can carry schema or query internals.
    console.error('[runtime/v1/agents] catalogue read failed', err)
    return NextResponse.json(
      { error: isPgrestTimeout(err) ? 'catalogue timed out' : 'catalogue unavailable' },
      { status: 503 }
    )
  }
}
