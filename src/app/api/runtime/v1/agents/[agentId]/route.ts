import { NextResponse } from 'next/server'

import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'
import { getPublishedAgent } from '@/lib/agent-mission-control/runtime-catalogue'
import {
  RUNTIME_CONTRACT_VERSION,
  isValidAgentId,
  requireRuntimeApiAuth,
} from '@/lib/agent-mission-control/runtime-api-types'

/**
 * GET /api/runtime/v1/agents/:agentId — one published agent.
 *
 * 404 when the id resolves to no canonical agent. That is the contract a
 * consumer relies on to detect an agent deleted upstream, so it must be able
 * to tell "gone" from "temporarily unreachable" — which is why a backend
 * failure answers 503 here and never a bare 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const auth = requireRuntimeApiAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { agentId } = await params
  if (!isValidAgentId(agentId)) {
    return NextResponse.json({ error: 'invalid agentId' }, { status: 400 })
  }

  try {
    const agent = await getPublishedAgent(agentId)
    if (agent === undefined) {
      return NextResponse.json({ error: 'agent not found' }, { status: 404 })
    }
    return NextResponse.json({ contractVersion: RUNTIME_CONTRACT_VERSION, agent })
  } catch (err) {
    // Never forward upstream text: it can carry schema or query internals.
    console.error('[runtime/v1/agents/:id] read failed', err)
    return NextResponse.json(
      { error: isPgrestTimeout(err) ? 'catalogue timed out' : 'catalogue unavailable' },
      { status: 503 }
    )
  }
}
