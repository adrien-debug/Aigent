import { NextResponse } from 'next/server'

import { getThreadDetail } from '@/lib/agent-mission-control/langgraph-explorer'

/**
 * GET /api/agent-ops/langgraph/threads/:threadId — read one thread's state on
 * the LangGraph Agent Server. READ-ONLY, redacted: returns status, current
 * node, interrupts and messages — never a secret, never a header.
 *
 * Auth: src/proxy.ts. Fail-closed 503 without the Agent Server secret. 404 when
 * the thread is unknown on the server. 400 on a malformed id. 502 on transport.
 */
// Thread ids are UUIDv7-ish (hyphenated hex). Bound + charset-check before use.
const THREAD_ID_RE = /^[a-zA-Z0-9-]{1,100}$/

/**
 * Cap on messages returned per thread (keep the most recent). The helper maps
 * the WHOLE thread state (each message already truncated to 4000 chars, but
 * unbounded in count) — a long-running thread would otherwise serialize a
 * multi-MB JSON response. Aligned on the repo's other bounds (threads 50,
 * assistants 100, history 40).
 */
const MESSAGES_LIMIT = 200

export async function GET(_request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params
  if (!THREAD_ID_RE.test(threadId)) {
    return NextResponse.json({ error: 'invalid threadId' }, { status: 400 })
  }
  if (!process.env.LANGGRAPH_SERVER_SECRET) {
    return NextResponse.json({ error: 'LangGraph Agent Server not configured' }, { status: 503 })
  }
  try {
    const detail = await getThreadDetail(threadId)
    if (!detail) {
      return NextResponse.json({ error: 'thread not found on the Agent Server' }, { status: 404 })
    }
    return NextResponse.json({
      ok: true,
      ...detail,
      messages: detail.messages.slice(-MESSAGES_LIMIT),
    })
  } catch (err) {
    console.error('[agent-ops/langgraph/threads/:id] read failed', err)
    return NextResponse.json({ error: 'failed to read thread' }, { status: 502 })
  }
}
