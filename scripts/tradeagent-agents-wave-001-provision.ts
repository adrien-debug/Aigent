/**
 * TRADEAGENT-AGENTS-WAVE-001 — provision the two TradeAgent business copilots.
 *
 * Run: npx tsx --env-file=.env.local --conditions=react-server \
 *        scripts/tradeagent-agents-wave-001-provision.ts
 */

import { createCopilotFromManifest } from '../src/lib/agent-mission-control/authoring-writes'
import { pgrest } from '../src/lib/agent-mission-control/postgrest'
import type { CreateCopilotInput, ProposedTool } from '../src/lib/agent-mission-control/authoring-types'
import { MARKET_TOOL_DEFINITIONS } from '../src/lib/agent-mission-control/market/promoted-tool-mapping.mjs'
import { TRADING_TOOL_DESCRIPTIONS } from '../src/lib/agent-mission-control/market/tool-descriptions'

const TARGET_PROJECT_ID = 'proj-tradeagent'
const MODEL = 'gpt-5.4'
const APP_BASE = `http://127.0.0.1:${Number(process.env.AIGENT_DEV_PORT) || 3210}`
const AMC_KEY = process.env.AMC_API_KEY

const WAVE_AGENTS = [
  {
    slug: 'tradeagent-market-intelligence',
    name: 'TradeAgent Market Intelligence',
    description: 'BTCUSDT market intelligence synthesis from six read-only market tools.',
    runtime: 'langgraph' as const,
    toolNames: [
      'read_market_snapshot',
      'read_volatility_state',
      'read_market_structure',
      'read_multi_timeframe_candles',
      'read_liquidity_snapshot',
      'read_derivatives_snapshot',
    ],
    systemPromptSummary:
      'TradeAgent Market Intelligence synthesizes BTCUSDT market state strictly from read-only market tools. Always call read_market_snapshot, read_volatility_state, read_market_structure, read_multi_timeframe_candles, read_liquidity_snapshot, and read_derivatives_snapshot before answering. Never invent prices, levels, or regime labels. Output JSON with market_regime, regime_confidence, trend_by_timeframe, key_levels, volatility_state, liquidity_state, derivatives_state, alerts, unavailable_data, and source_freshness.',
    scenario:
      'Synthesize current BTCUSDT market intelligence using all six market tools. Cite freshness and mark unavailable_data explicitly.',
  },
  {
    slug: 'tradeagent-portfolio-risk-guardian',
    name: 'TradeAgent Portfolio Risk Guardian',
    description: 'Portfolio risk guardian for explicit TradeAgent accounts with market context.',
    runtime: 'langgraph' as const,
    toolNames: [
      'read_account_risk_snapshot',
      'read_market_snapshot',
      'read_volatility_state',
      'read_liquidity_snapshot',
      'read_derivatives_snapshot',
    ],
    systemPromptSummary:
      'TradeAgent Portfolio Risk Guardian assesses portfolio risk for an explicit account id using read_account_risk_snapshot plus market context tools. Never pick a random account. Output JSON with risk_score, risk_level, exposure_summary, concentration_risk, leverage_risk, liquidity_risk, liquidation_risk, withdrawal_capacity, withdrawal_recommendation, required_human_action, and unavailable_data.',
    scenario:
      'Assess portfolio risk for the provided account id using all five tools. Do not execute any withdrawal.',
  },
] as const

function proposedTools(toolNames: readonly string[]): ProposedTool[] {
  return toolNames.map((name) => {
    const definition = MARKET_TOOL_DEFINITIONS[name as keyof typeof MARKET_TOOL_DEFINITIONS]
    return {
      name,
      description:
        definition?.description ??
        TRADING_TOOL_DESCRIPTIONS[name] ??
        `Read-only market tool ${name}.`,
      provider: 'internal' as const,
      riskLevel: 'low' as const,
      requiresConfirmation: false,
    }
  })
}

async function reprovision(copilotId: string, projectId: string): Promise<void> {
  if (!AMC_KEY) throw new Error('AMC_API_KEY is required for reprovision')
  const response = await fetch(`${APP_BASE}/api/agent-ops/copilots/${copilotId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-amc-key': AMC_KEY },
    body: JSON.stringify({ projectId }),
    signal: AbortSignal.timeout(30_000),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || result.reprovisioned !== true) {
    throw new Error(`assistant reprovision failed for ${copilotId}`)
  }
}

async function ensureCopilot(agent: (typeof WAVE_AGENTS)[number]): Promise<string> {
  const existing = await pgrest<Array<{ id: string }>>(
    'GET',
    `copilots?slug=eq.${encodeURIComponent(agent.slug)}&select=id`,
  )
  if (existing[0]?.id) return existing[0].id

  const input: CreateCopilotInput = {
    name: agent.name,
    slug: agent.slug,
    description: agent.description,
    runtime: agent.runtime,
    model: MODEL,
    modelProvider: 'openai',
    owner: 'tradeagent-agents-wave-001',
    tags: ['tradeagent', 'wave-001'],
    projectId: TARGET_PROJECT_ID,
    targetProjectIds: [TARGET_PROJECT_ID],
    manifest: {
      systemPromptSummary: agent.systemPromptSummary,
      allowedRoutes: ['/api/market/*', '/api/internal/portfolio-risk/*'],
      forbiddenActions: ['execute withdrawals', 'place orders', 'write to external systems'],
      confirmationPolicy: 'risky-only',
      alwaysConfirmActions: [],
      outputContract: {
        format: 'json',
        schemaName: `${agent.slug}.v1`,
        invariants: ['read-only', 'never fabricates unavailable metrics'],
      },
      proposedTools: proposedTools(agent.toolNames),
      skills: [],
      maxStepsPerRun: 12,
      maxCostPerRunUsd: 0.5,
    },
  }
  return createCopilotFromManifest(input)
}

async function main() {
  const results: Array<{ slug: string; copilotId: string }> = []

  for (const agent of WAVE_AGENTS) {
    const copilotId = await ensureCopilot(agent)
    await reprovision(copilotId, TARGET_PROJECT_ID)
    results.push({ slug: agent.slug, copilotId })
    console.log(`provisioned ${agent.slug} -> ${copilotId}`)
  }

  console.log(JSON.stringify({ results, scenario: WAVE_AGENTS[0].scenario }, null, 2))
}

main().catch((error) => {
  console.error('tradeagent-agents-wave-001-provision failed:', error)
  process.exit(1)
})
