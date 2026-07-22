import { NextResponse } from 'next/server'

import { TRADING_TOOL_HANDLERS, TRADING_TOOL_IDS } from '@/lib/agent-mission-control/market/tools'

// The bridge allowlist IS the handler set — derived, never a hand-maintained
// copy. The previous hardcoded list had drifted (it omitted
// read_funding_open_interest), so a tool the LangGraph graph mounts for the
// model and that has a real handler 404'd here at call time: the agent looked
// healthy and silently could not use it. Deriving from TRADING_TOOL_IDS makes
// that class of drift structurally impossible.
const LANGGRAPH_MARKET_TOOL_IDS = new Set(TRADING_TOOL_IDS)

/**
 * Internal authenticated bridge from the separate LangGraph Agent Server
 * process to the canonical server-only market handlers. Authentication is
 * fail-closed in src/proxy.ts via x-amc-key before this route runs.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ toolName: string }> }
) {
  const { toolName } = await params
  if (!LANGGRAPH_MARKET_TOOL_IDS.has(toolName)) {
    return NextResponse.json({ ok: false, error: 'unknown market tool' }, { status: 404 })
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
  if ('fixtureScenario' in body.args) {
    return NextResponse.json(
      { ok: false, error: 'runtime fixture selection is not allowed' },
      { status: 400 }
    )
  }

  const handler = TRADING_TOOL_HANDLERS[toolName]
  if (!handler) {
    return NextResponse.json({ ok: false, error: 'market handler unavailable' }, { status: 503 })
  }

  try {
    const result = await handler(JSON.stringify(body.args))
    return NextResponse.json(result)
  } catch (error) {
    console.error(`[agent-ops/market-tools] ${toolName} failed`, error)
    return NextResponse.json({ ok: false, error: 'market handler failed' }, { status: 502 })
  }
}
