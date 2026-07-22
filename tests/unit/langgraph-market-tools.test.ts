import { afterEach, describe, expect, it } from 'vitest'

import { buildCopilotBehaviorConfig } from '@/lib/agent-mission-control/copilot-behavior'
import {
  MARKET_TOOL_DEFINITIONS,
  PROMOTED_MARKET_AGENTS,
} from '@/lib/agent-mission-control/market/promoted-tool-mapping.mjs'
import {
  buildTool,
  MARKET_TOOL_IDS,
  REGISTRY_IDS,
} from '@/langgraph/tool-registry.mjs'

/**
 * Order-sensitive: mirrors MARKET_TOOL_SPECS declaration order.
 *
 * `read_funding_open_interest` joined the registry when check-registry-parity
 * caught it — its handler and description had existed on the direct path all
 * along, but the LangGraph registry never built it, so any agent declaring it
 * would have mounted nothing while the catalogue reported the agent healthy.
 */
const EXPECTED_MARKET_TOOLS = [
  'read_market_snapshot',
  'read_volatility_state',
  'read_market_structure',
  'read_multi_timeframe_candles',
  'read_liquidity_snapshot',
  'read_derivatives_snapshot',
  'read_macro_context',
  'read_funding_open_interest',
  'read_account_risk_snapshot',
]

const previousAmcKey = process.env.AMC_API_KEY

afterEach(() => {
  if (previousAmcKey === undefined) delete process.env.AMC_API_KEY
  else process.env.AMC_API_KEY = previousAmcKey
})

describe('LangGraph market read tools', () => {
  it('resolves all nine canonical names to executable registry tools', () => {
    expect([...MARKET_TOOL_IDS]).toEqual(EXPECTED_MARKET_TOOLS)
    expect(REGISTRY_IDS).toEqual(expect.arrayContaining(EXPECTED_MARKET_TOOLS))
    for (const name of EXPECTED_MARKET_TOOLS) {
      expect(buildTool(name)?.name).toBe(name)
    }
  })

  it('does not drop a valid market tool from copilot behavior', () => {
    const config = buildCopilotBehaviorConfig({
      copilot: { id: 'copilot-market', name: 'Market Agent', model: 'gpt-5.4' },
      manifest: null,
      tools: [
        {
          name: 'read_market_snapshot',
          risk_level: 'low',
          requires_confirmation: false,
        },
      ],
      repoFullName: null,
    })

    expect(config.tools).toContainEqual({
      id: 'read_market_snapshot',
      riskLevel: 'low',
      requiresConfirmation: false,
    })
    expect(config.unmappedToolNames).toEqual([])
  })

  it('keeps every promoted market capability read-only and confirmation-free', () => {
    for (const agent of PROMOTED_MARKET_AGENTS) {
      for (const name of agent.toolNames) {
        const definition = Object.entries(MARKET_TOOL_DEFINITIONS).find(([id]) => id === name)?.[1]
        expect(definition).toMatchObject({ mutates: false })
      }
      const config = buildCopilotBehaviorConfig({
        copilot: { id: agent.id, name: agent.name, model: 'gpt-5.4' },
        manifest: null,
        tools: agent.toolNames.map((name) => ({
          name,
          risk_level: 'low',
          requires_confirmation: false,
        })),
        repoFullName: null,
      })
      expect(config.tools.map((entry) => entry.id)).toEqual(agent.toolNames)
      expect(config.unmappedToolNames).toEqual([])
      for (const name of agent.toolNames) {
        expect(config.tools.find((entry) => entry.id === name)).toMatchObject({
          riskLevel: 'low',
          requiresConfirmation: false,
        })
      }
    }
  })

  it('fails cleanly when the authenticated market bridge is unavailable', async () => {
    delete process.env.AMC_API_KEY
    const marketSnapshot = buildTool('read_market_snapshot')
    await expect(marketSnapshot?.invoke({ pair: 'ETHUSDT' })).resolves.toContain(
      'market tool bridge unavailable'
    )
  })

  it('maps only the requested least-privilege tools to the five promoted agents', () => {
    expect(
      Object.fromEntries(PROMOTED_MARKET_AGENTS.map((agent) => [agent.name, agent.toolNames]))
    ).toEqual({
      'BTC Alert & Levels Sentinel': [
        'read_market_snapshot',
        'read_volatility_state',
        'read_market_structure',
        'read_multi_timeframe_candles',
        'read_liquidity_snapshot',
      ],
      'Market Regime & Rotation Copilot': [
        'read_market_snapshot',
        'read_volatility_state',
        'read_market_structure',
        'read_macro_context',
        'read_multi_timeframe_candles',
      ],
      'Portfolio Risk & Lock Advisor': [
        'read_account_risk_snapshot',
        'read_market_snapshot',
        'read_volatility_state',
        'read_liquidity_snapshot',
        'read_derivatives_snapshot',
      ],
      'Source Reliability & Price Trust Sentinel': [
        'read_market_snapshot',
        'read_liquidity_snapshot',
        'read_market_structure',
        'read_macro_context',
      ],
      'Withdrawal Review Copilot': [
        'read_account_risk_snapshot',
        'read_market_snapshot',
        'read_volatility_state',
        'read_liquidity_snapshot',
        'read_derivatives_snapshot',
      ],
    })
  })
})
