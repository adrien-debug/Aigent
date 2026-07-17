import { NextResponse } from 'next/server'

import { isValidAgentId, requireRuntimeApiAuth } from '@/lib/agent-mission-control/runtime-api-types'

/**
 * POST /api/runtime/v1/agents/:agentId/runs — start a run for one published
 * agent.
 *
 * Skeleton: no real agent has been materialized in the DB yet, so this
 * always returns a clean 404 for the target agent (never fabricates a run
 * against a mock agent) once auth + shape checks pass. Wiring to the real
 * run orchestrator (idempotency-key dedup, requestId propagation) lands
 * with the materialization work — see docs/projects/real-estate-agent/
 * runtime-api.md for the intended request/response contract.
 */
export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const auth = requireRuntimeApiAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { agentId } = await params
  if (!isValidAgentId(agentId)) {
    return NextResponse.json({ error: 'invalid agentId' }, { status: 400 })
  }

  return NextResponse.json({ error: 'agent not found' }, { status: 404 })
}
