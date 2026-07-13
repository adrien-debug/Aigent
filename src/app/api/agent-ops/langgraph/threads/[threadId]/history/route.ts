import { NextResponse } from 'next/server'

import { getThreadHistory } from '@/lib/agent-mission-control/langgraph-explorer'

/**
 * GET /api/agent-ops/langgraph/threads/:threadId/history — the redacted
 * checkpoint history (run replay trail) of a thread on the Agent Server.
 * READ-ONLY. Returns steps oldest→newest, each with its `next` node, status,
 * timestamp, message/tool summary and interrupts — never a secret, never a
 * header, never the checkpoint metadata (systemPrompt/tools config).
 *
 * Auth: src/proxy.ts. Fail-closed 503 without the Agent Server secret. 400 on a
 * malformed id. 502 on transport. Empty history → `{ ok:true, history:[] }`
 * (the client then falls back to state/messages).
 */
const THREAD_ID_RE = /^[a-zA-Z0-9-]{1,100}$/

export async function GET(_request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params
  if (!THREAD_ID_RE.test(threadId)) {
    return NextResponse.json({ error: 'invalid threadId' }, { status: 400 })
  }
  if (!process.env.LANGGRAPH_SERVER_SECRET) {
    return NextResponse.json({ error: 'LangGraph Agent Server not configured' }, { status: 503 })
  }
  try {
    const history = await getThreadHistory(threadId)
    return NextResponse.json({ ok: true, threadId, history })
  } catch (err) {
    console.error('[agent-ops/langgraph/threads/:id/history] read failed', err)
    return NextResponse.json({ error: 'failed to read thread history' }, { status: 502 })
  }
}
