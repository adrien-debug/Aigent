import { NextResponse } from 'next/server'

import { listThreads } from '@/lib/agent-mission-control/langgraph-explorer'

/**
 * GET /api/agent-ops/langgraph/threads — list recent threads/runs on the
 * LangGraph Agent Server the app uses. READ-ONLY, redacted (no secret, no
 * header ever in the response).
 *
 * Auth: src/proxy.ts. Fail-closed 503 without the Agent Server secret. 502 on a
 * server/transport error.
 */
export async function GET() {
  // Mirror agentServerClient()'s definition of "absent": a whitespace-only
  // secret is not configured — answer 503 here rather than letting the bare
  // client hit the server unauthenticated and misreport the config fault as 502.
  if (!process.env.LANGGRAPH_SERVER_SECRET?.trim()) {
    return NextResponse.json({ error: 'LangGraph Agent Server not configured' }, { status: 503 })
  }
  try {
    const threads = await listThreads()
    return NextResponse.json({ ok: true, threads })
  } catch (err) {
    console.error('[agent-ops/langgraph/threads] list failed', err)
    return NextResponse.json({ error: 'failed to list threads' }, { status: 502 })
  }
}
