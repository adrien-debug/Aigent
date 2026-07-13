import { NextResponse } from 'next/server'

import { getGraphTopology } from '@/lib/agent-mission-control/langgraph-explorer'

/**
 * GET /api/agent-ops/langgraph/graphs/:graphId — the redacted node/edge topology
 * of a graph on the Agent Server. READ-ONLY.
 *
 * Returns { ok, graphId, topologyAvailable, nodes, edges }. When the server has
 * no assistant for the graph (or the graph endpoint errors), `topologyAvailable`
 * is false with empty nodes/edges — the client then renders its hard-coded
 * fallback topology. Never a secret, never a header, never the JSON-schema data
 * blob a schema node carries.
 *
 * Auth: src/proxy.ts. Fail-closed 503 without the Agent Server secret. 400 on a
 * malformed id. 502 on transport.
 */
const GRAPH_ID_RE = /^[a-zA-Z0-9_-]{1,100}$/

export async function GET(_request: Request, { params }: { params: Promise<{ graphId: string }> }) {
  const { graphId } = await params
  if (!GRAPH_ID_RE.test(graphId)) {
    return NextResponse.json({ error: 'invalid graphId' }, { status: 400 })
  }
  if (!process.env.LANGGRAPH_SERVER_SECRET) {
    return NextResponse.json({ error: 'LangGraph Agent Server not configured' }, { status: 503 })
  }
  try {
    const topology = await getGraphTopology(graphId)
    return NextResponse.json({ ok: true, ...topology })
  } catch (err) {
    console.error('[agent-ops/langgraph/graphs/:id] read failed', err)
    return NextResponse.json({ error: 'failed to read graph topology' }, { status: 502 })
  }
}
