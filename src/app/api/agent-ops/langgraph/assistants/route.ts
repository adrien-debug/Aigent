import { NextResponse } from 'next/server'

import { AGENT_BUILDER_GRAPH_ID } from '@/lib/agent-mission-control/langgraph-client'
import { listAssistants } from '@/lib/agent-mission-control/langgraph-explorer'

/**
 * GET /api/agent-ops/langgraph/assistants — list the assistants on the LangGraph
 * Agent Server the app uses (agent.hearst.app in prod). READ-ONLY, redacted.
 *
 * Auth: src/proxy.ts. Fail-closed 503 without the Agent Server secret. The
 * `x-agent-key` lives only in the server-side client — it never appears in this
 * response. 502 on a server/transport error (message not forwarded verbatim).
 */
export async function GET() {
  if (!process.env.LANGGRAPH_SERVER_SECRET) {
    return NextResponse.json({ error: 'LangGraph Agent Server not configured' }, { status: 503 })
  }
  try {
    const assistants = await listAssistants()
    return NextResponse.json({ ok: true, graph: AGENT_BUILDER_GRAPH_ID, assistants })
  } catch (err) {
    console.error('[agent-ops/langgraph/assistants] list failed', err)
    return NextResponse.json({ error: 'failed to list assistants' }, { status: 502 })
  }
}
