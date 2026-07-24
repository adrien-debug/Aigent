import { NextResponse } from 'next/server'

import { REALESTATE_TOOL_HANDLERS, REALESTATE_TOOL_IDS } from '@/lib/agent-mission-control/realestate/tools'

// The bridge allowlist IS the handler set — derived, never a hand-maintained
// copy (same discipline as market-tools/[toolName]/route.ts — see its comment
// for the drift incident that motivated this).
const LANGGRAPH_REALESTATE_TOOL_IDS = new Set(REALESTATE_TOOL_IDS)

/**
 * Internal authenticated bridge from the separate LangGraph Agent Server
 * process to the canonical server-only real-estate handlers. Authentication is
 * fail-closed in src/proxy.ts via x-amc-key before this route runs.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ toolName: string }> }
) {
  const { toolName } = await params
  if (!LANGGRAPH_REALESTATE_TOOL_IDS.has(toolName)) {
    return NextResponse.json({ ok: false, error: 'unknown real-estate tool' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    Array.isArray(body) ||
    !('args' in body) ||
    typeof body.args !== 'object' ||
    body.args === null ||
    Array.isArray(body.args)
  ) {
    return NextResponse.json({ ok: false, error: 'args must be an object' }, { status: 400 })
  }

  const handler = REALESTATE_TOOL_HANDLERS[toolName]
  if (!handler) {
    return NextResponse.json({ ok: false, error: 'real-estate handler unavailable' }, { status: 503 })
  }

  try {
    const result = await handler(JSON.stringify(body.args))
    return NextResponse.json(result)
  } catch (error) {
    console.error(`[agent-ops/realestate-tools] ${toolName} failed`, error)
    return NextResponse.json({ ok: false, error: 'real-estate handler failed' }, { status: 502 })
  }
}
