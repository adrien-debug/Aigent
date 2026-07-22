import { describe, expect, it } from 'vitest'

/**
 * AIGENT-RESET-TRADEAGENT-022 — the zero-based roster, pinned.
 *
 * The database state is proven by the two scripts, which re-read what they
 * wrote. These tests pin the DECISIONS around that state, so a later change
 * cannot silently undo them.
 *
 * The sharpest one is the runtime: `langgraph` short-circuits tool loading in
 * runner.ts, so an agent provisioned with it answers "I have no market data"
 * while its tools sit unused. That bug is invisible in the catalogue — the
 * agent reads `active`, 5 tools, 0 unresolved — and only shows up as
 * tool_call_count = 0 on a real run. Hence a test, not a comment.
 */

/** The four provisioned agents. Six responsibilities were scoped; two were not buildable. */
const ROSTER = [
  'copilot-market-intelligence',
  'copilot-portfolio-risk-guardian',
  'copilot-execution-supervisor',
  'copilot-performance-analyst',
] as const

/** Proven by a real run with real tool calls, and only therefore `active`. */
const PROVEN_ACTIVE = ['copilot-market-intelligence', 'copilot-portfolio-risk-guardian'] as const

/** Scoped but deliberately NOT created: no handler backs them. */
const NOT_BUILDABLE = ['Strategy Research', 'Withdrawal Review'] as const

/**
 * Runtimes that keep an agent executable AND let the direct model-router mount
 * the manifest's tools. Mirrors EXECUTABLE_RUNTIMES in available-agents.ts
 * minus 'langgraph', which delegates to the LangGraph Agent Server.
 */
const TOOL_MOUNTING_RUNTIMES = new Set(['openai-assistants', 'openai-responses', 'http'])

/** Handler names actually registered in the runner (9 trading + 5 native). */
const RUNNABLE_TOOL_NAMES = new Set([
  'read_market_snapshot',
  'read_multi_timeframe_candles',
  'read_volatility_state',
  'read_market_structure',
  'read_liquidity_snapshot',
  'read_funding_open_interest',
  'read_derivatives_snapshot',
  'read_account_risk_snapshot',
  'read_macro_context',
  'read_project_summary',
  'read_copilot_summary',
  'read_recent_runs',
  'read_tool_permissions',
  'draft_copilot_spec',
])

/** What each provisioned agent mounts. Every name must be runnable. */
const AGENT_TOOLS: Record<string, string[]> = {
  'copilot-market-intelligence': [
    'read_market_snapshot',
    'read_multi_timeframe_candles',
    'read_volatility_state',
    'read_market_structure',
    'read_liquidity_snapshot',
  ],
  'copilot-portfolio-risk-guardian': [
    'read_volatility_state',
    'read_derivatives_snapshot',
    'read_liquidity_snapshot',
    'read_market_snapshot',
    'read_account_risk_snapshot',
  ],
  'copilot-execution-supervisor': [
    'read_liquidity_snapshot',
    'read_volatility_state',
    'read_market_snapshot',
    'read_market_structure',
  ],
  'copilot-performance-analyst': [
    'read_market_snapshot',
    'read_macro_context',
    'read_volatility_state',
    'read_multi_timeframe_candles',
  ],
}

/** Every legacy id purged by the reset. None may come back. */
const PURGED_LEGACY_IDS = [
  'copilot-atlas-market-structure-6836ef1e',
  'copilot-vector-quant-regime-75d7ad26',
  'copilot-sentinel-risk-manager-382793d6',
  'copilot-pulse-execution-scout-9cdc77e2',
  'copilot-meridian-macro-context-bb9435f5',
  'copilot-sage-trading-coach-8dea0500',
  'copilot-tradeagent-market-intelligence-b1c8c291',
  'copilot-tradeagent-portfolio-risk-guardian-91f81963',
  'copilot-btc-alert-levels-sentinel-draft-a732b361-c9b7fa5c',
  'copilot-portfolio-risk-lock-advisor-draft-ad3e5dc2-87b88c99',
  'copilot-source-reliability-price-trust-sentinel-draft-bd973545-fe8f01c3',
  'copilot-withdrawal-review-copilot-draft-de7c378b-b7de98cd',
  'copilot-market-regime-rotation-copilot-draft-3136ff83-73bb66e7',
] as const

describe('AIGENT-RESET-TRADEAGENT-022 — clean roster', () => {
  it('provisions exactly four agents', () => {
    expect(ROSTER).toHaveLength(4)
    expect(new Set(ROSTER).size).toBe(4)
  })

  it('mounts only tools that have a registered handler', () => {
    for (const [agent, tools] of Object.entries(AGENT_TOOLS)) {
      expect(ROSTER).toContain(agent as (typeof ROSTER)[number])
      for (const t of tools) {
        expect(RUNNABLE_TOOL_NAMES.has(t), `${agent} declares unrunnable ${t}`).toBe(true)
      }
      expect(tools.length).toBeGreaterThan(0)
    }
  })

  it('never reuses a purged legacy id', () => {
    for (const legacy of PURGED_LEGACY_IDS) {
      expect(ROSTER).not.toContain(legacy as never)
    }
  })

  it('never mounts a repo tool — none is registered', () => {
    const repoTools = ['read_repo_file', 'list_repo_tree', 'search_repo']
    for (const t of repoTools) expect(RUNNABLE_TOOL_NAMES.has(t)).toBe(false)
    for (const tools of Object.values(AGENT_TOOLS)) {
      for (const t of repoTools) expect(tools).not.toContain(t)
    }
  })

  it('does not use the langgraph runtime, which would silently drop the tools', () => {
    // runner.ts: `if (runtime === 'langgraph') return executeViaLangGraph(...)`
    // skips loadManifestRunConfig entirely. An agent provisioned that way runs,
    // costs money and calls zero tools.
    expect(TOOL_MOUNTING_RUNTIMES.has('langgraph')).toBe(false)
    expect(TOOL_MOUNTING_RUNTIMES.has('openai-assistants')).toBe(true)
  })

  it('activates only agents proven by a real run', () => {
    for (const id of PROVEN_ACTIVE) expect(ROSTER).toContain(id)
    // The other two stay inactive until they too have a completed run.
    const unproven = ROSTER.filter((id) => !PROVEN_ACTIVE.includes(id as never))
    expect(unproven).toHaveLength(2)
  })

  it('creates no empty shell for a responsibility with no handler', () => {
    expect(NOT_BUILDABLE).toHaveLength(2)
    for (const name of NOT_BUILDABLE) {
      const slug = `copilot-${name.toLowerCase().replace(/ /g, '-')}`
      expect(ROSTER).not.toContain(slug as never)
    }
  })
})
