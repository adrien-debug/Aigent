import { NextResponse } from 'next/server'

import { TRADING_TOOL_HANDLERS } from '@/lib/agent-mission-control/market/tools'

const LANGGRAPH_MARKET_TOOL_IDS = new Set([
  'read_market_snapshot',
  'read_volatility_state',
  'read_market_structure',
  'read_multi_timeframe_candles',
  'read_liquidity_snapshot',
  'read_macro_context',
  'read_account_risk_snapshot',
])

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
