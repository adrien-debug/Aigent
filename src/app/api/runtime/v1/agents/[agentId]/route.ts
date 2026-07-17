import { NextResponse } from 'next/server'

import { isValidAgentId, requireRuntimeApiAuth } from '@/lib/agent-mission-control/runtime-api-types'

/**
 * GET /api/runtime/v1/agents/:agentId — fetch one published agent by id.
 *
 * Skeleton: no real agent has been materialized in the DB yet, so this
 * always returns a clean 404 (never a fabricated/mock agent) once auth +
 * shape checks pass. Wiring to the real store lands with the
 * materialization work.
 */
export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const auth = requireRuntimeApiAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { agentId } = await params
  if (!isValidAgentId(agentId)) {
    return NextResponse.json({ error: 'invalid agentId' }, { status: 400 })
  }

  return NextResponse.json({ error: 'agent not found' }, { status: 404 })
}
