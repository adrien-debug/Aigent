/**
 * AIG-TRADE-001 — LOT 2 roster tests.
 *
 * Pure, offline: no LLM, no network, no secrets. Asserts the six founding
 * trading copilots are well-formed and that the machine-checkable mission
 * invariants hold — tool allowlist ⊆ TRADING_TOOL_IDS, contract names ∈
 * OUTPUT_CONTRACTS, unique slugs, mono-accent, and the per-agent safety facts
 * (Sentinel reads account risk, Meridian keeps BTC context-only).
 */
import { describe, it, expect } from 'vitest'
import {
  ROSTER,
  getAgentBySlug,
  agentContractName,
  agentContractSchema,
  type TradingAgentDef,
} from '@/lib/agent-mission-control/market/agents/roster'
import { OUTPUT_CONTRACTS, type OutputContractName } from '@/lib/agent-mission-control/market/contracts'
import { TRADING_TOOL_IDS } from '@/lib/agent-mission-control/market/tools'

const CONTRACT_NAMES = Object.keys(OUTPUT_CONTRACTS) as OutputContractName[]
const TOOL_SET = new Set(TRADING_TOOL_IDS)

describe('trading roster (Lot 2)', () => {
  it('defines exactly six founding agents', () => {
    expect(ROSTER).toHaveLength(6)
  })

  it('has unique slugs (kebab-case)', () => {
    const slugs = ROSTER.map((a) => a.slug)
    expect(new Set(slugs).size).toBe(6)
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  it('has unique names', () => {
    const names = ROSTER.map((a) => a.name)
    expect(new Set(names).size).toBe(6)
  })

  it('covers the expected named agents', () => {
    expect(ROSTER.map((a) => a.name).sort()).toEqual(
      ['Atlas', 'Meridian', 'Pulse', 'Sage', 'Sentinel', 'Vector'].sort(),
    )
  })

  it('every toolId is a known TRADING_TOOL_ID', () => {
    for (const agent of ROSTER) {
      expect(agent.toolIds.length).toBeGreaterThan(0)
      for (const toolId of agent.toolIds) {
        expect(TOOL_SET.has(toolId)).toBe(true)
      }
      // No duplicate tools within an agent.
      expect(new Set(agent.toolIds).size).toBe(agent.toolIds.length)
    }
  })

  it('every schemaName is a known contract, and JSON format', () => {
    for (const agent of ROSTER) {
      expect(CONTRACT_NAMES).toContain(agent.outputContract.schemaName)
      expect(agent.outputContract.format).toBe('json')
      expect(agent.outputContract.invariants.length).toBeGreaterThan(0)
    }
  })

  it('the six agents map onto the six distinct contracts', () => {
    const schemas = ROSTER.map((a) => a.outputContract.schemaName)
    expect(new Set(schemas).size).toBe(6)
    expect([...schemas].sort()).toEqual([...CONTRACT_NAMES].sort())
  })

  it('is mono-accent: only accent or zinc', () => {
    for (const agent of ROSTER) {
      expect(['accent', 'zinc']).toContain(agent.accent)
    }
  })

  it('all agents are AI assistants (invariant #5)', () => {
    for (const agent of ROSTER) {
      expect(agent.isAiAssistant).toBe(true)
    }
  })

  it('avatarRef is a configurable ref, never a baked-in asset', () => {
    for (const agent of ROSTER) {
      // null (default) or a plain id string — never a data URI / path to media.
      if (agent.avatarRef !== null) {
        expect(typeof agent.avatarRef).toBe('string')
        expect(agent.avatarRef).not.toMatch(/^data:|\.(png|jpe?g|svg|webp|gif)$/i)
      }
    }
  })

  it('runs the gamme on risky-only confirmation policy', () => {
    for (const agent of ROSTER) {
      expect(agent.confirmationPolicy).toBe('risky-only')
    }
  })

  it('every system prompt embeds the core safety invariants', () => {
    for (const agent of ROSTER) {
      const p = agent.systemPromptSummary
      expect(p).toContain('(#1)') // no orders
      expect(p).toContain('(#3)') // no private keys
      expect(p).toContain('(#4)') // no return promise
      expect(p).toContain('(#5)') // AI assistant
      expect(p).toContain('(#7)') // provenance/freshness
      expect(p).toContain('(#8)') // UNAVAILABLE never fabricated
      expect(p).toContain('(#12)') // no bare BUY/SELL
      expect(p).toContain('(#14)') // ETH-only executable universe
    }
  })

  it('routes stay within the market/read allowlist', () => {
    for (const agent of ROSTER) {
      expect(agent.allowedRoutes.length).toBeGreaterThan(0)
      for (const route of agent.allowedRoutes) {
        expect(route.startsWith('/api/market/')).toBe(true)
      }
    }
  })

  it('every agent has bounded step/cost/latency budgets', () => {
    for (const agent of ROSTER) {
      expect(agent.maxStepsPerRun).toBeGreaterThan(0)
      expect(agent.maxCostPerRunUsd).toBeGreaterThan(0)
      expect(agent.maxLatencyMsTarget).toBeGreaterThan(0)
    }
  })

  it('every agent declares at least one skill', () => {
    for (const agent of ROSTER) {
      expect(agent.skills.length).toBeGreaterThan(0)
      for (const s of agent.skills) expect(s.label.length).toBeGreaterThan(0)
    }
  })
})

describe('per-agent invariants', () => {
  const by = (slug: string): TradingAgentDef => {
    const a = getAgentBySlug(slug)
    if (!a) throw new Error(`missing agent ${slug}`)
    return a
  }

  it('Sentinel is the risk authority and reads account risk', () => {
    const sentinel = by('sentinel-risk-manager')
    expect(sentinel.toolIds).toContain('read_account_risk_snapshot')
    expect(sentinel.outputContract.schemaName).toBe('RiskAssessment')
    // Never originates a trade idea, never fabricates capital.
    expect(sentinel.forbiddenActions.some((f) => /generate|propose.*idea/i.test(f))).toBe(true)
    expect(sentinel.forbiddenActions.some((f) => /fabricate.*capital/i.test(f))).toBe(true)
  })

  it('Atlas produces a TechnicalAnalysisReport', () => {
    expect(by('atlas-market-structure').outputContract.schemaName).toBe('TechnicalAnalysisReport')
  })

  it('Vector produces a QuantRegimeReport', () => {
    expect(by('vector-quant-regime').outputContract.schemaName).toBe('QuantRegimeReport')
  })

  it('Pulse produces an ExecutionAssessment and never submits an order', () => {
    const pulse = by('pulse-execution-scout')
    expect(pulse.outputContract.schemaName).toBe('ExecutionAssessment')
    expect(pulse.forbiddenActions.some((f) => /submit|route.*order/i.test(f))).toBe(true)
  })

  it('Meridian marks BTC as context-only (never a recommendation)', () => {
    const meridian = by('meridian-macro-context')
    expect(meridian.outputContract.schemaName).toBe('MacroContextReport')
    expect(meridian.toolIds).toContain('read_macro_context')
    expect(
      meridian.forbiddenActions.some((f) => /outside the ETH executable universe|context only/i.test(f)),
    ).toBe(true)
    expect(meridian.systemPromptSummary).toMatch(/context ONLY/i)
  })

  it('Sage is educational, never a signal, never bypasses Sentinel', () => {
    const sage = by('sage-trading-coach')
    expect(sage.outputContract.schemaName).toBe('EducationalLesson')
    expect(sage.forbiddenActions.some((f) => /autonomous trade signal/i.test(f))).toBe(true)
    expect(sage.forbiddenActions.some((f) => /Sentinel/i.test(f))).toBe(true)
  })
})

describe('helpers', () => {
  it('getAgentBySlug resolves known and unknown slugs', () => {
    expect(getAgentBySlug('atlas-market-structure')?.name).toBe('Atlas')
    expect(getAgentBySlug('nope')).toBeUndefined()
  })

  it('agentContractName is consistent with contracts.ts', () => {
    for (const agent of ROSTER) {
      const name = agentContractName(agent)
      expect(CONTRACT_NAMES).toContain(name)
      // The resolved schema is the one registered under that name.
      expect(agentContractSchema(agent)).toBe(OUTPUT_CONTRACTS[name])
    }
  })
})
