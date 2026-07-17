import { describe, it, expect } from 'vitest'
import { ROSTER } from '@/lib/agent-mission-control/market/agents/roster'
import { packageForAgent } from '@/lib/agent-mission-control/market/delivery'
import { OUTPUT_CONTRACTS } from '@/lib/agent-mission-control/market/contracts'
import { TRADING_TOOL_IDS } from '@/lib/agent-mission-control/market/tools'

// Not-yet-materialized: no real benchmark evidence → honest EXPERIMENTAL.
const noEvidence = {
  evidenceLevel: 'NONE' as const,
  testsPassed: 0,
  testsTotal: 0,
  securityScore: 1,
  contractCompliance: 0,
  benchmarkGlobal: 0,
  gatesBlocked: false,
  blockReasons: [],
  costUsd: null,
  latencyMs: null,
}

describe('roster → delivery bridge (Lot 2 × Lot 10)', () => {
  it('every roster agent builds a valid, checksummed package', () => {
    for (const agent of ROSTER) {
      const pkg = packageForAgent({
        agent,
        version: 'v1.0.0-draft',
        model: 'gpt-5.4',
        runtime: 'langgraph',
        evidence: noEvidence,
        sourceStatus: ['candles: SNAPSHOT', 'accountRisk: UNAVAILABLE'],
        builtAt: '2026-07-18T00:00:00.000Z',
        pushedAt: '2026-07-18T00:00:00.000Z',
      })
      expect(pkg.checksum.startsWith('sha256:')).toBe(true)
      expect(pkg.files[`agents/${agent.slug}/manifest.json`]).toBeTruthy()
      // Output contract name is a real contract.
      expect(Object.keys(OUTPUT_CONTRACTS)).toContain(pkg.outputContractName)
      // Every required tool is a real trading tool.
      for (const t of pkg.requiredTools) {
        expect(TRADING_TOOL_IDS).toContain(t)
      }
      // Un-materialized agents are honestly EXPERIMENTAL, never DELIVERABLE.
      expect(pkg.status).toBe('EXPERIMENTAL')
      // README states it is an AI assistant and never trades.
      expect(pkg.files[`agents/${agent.slug}/README.md`]).toMatch(/AI assistant/i)
      expect(pkg.files[`agents/${agent.slug}/README.md`]).toMatch(/never/i)
    }
  })

  it('a fully-proven SNAPSHOT agent would be DELIVERABLE-SNAPSHOT', () => {
    const atlas = ROSTER[0]
    const pkg = packageForAgent({
      agent: atlas,
      version: 'v1.0.0-draft',
      model: 'gpt-5.4',
      runtime: 'langgraph',
      evidence: {
        evidenceLevel: 'SNAPSHOT',
        testsPassed: 20,
        testsTotal: 20,
        securityScore: 1,
        contractCompliance: 1,
        benchmarkGlobal: 0.96,
        gatesBlocked: false,
        blockReasons: [],
        costUsd: 0.1,
        latencyMs: 1500,
      },
      sourceStatus: ['candles: SNAPSHOT'],
      builtAt: '2026-07-18T00:00:00.000Z',
      pushedAt: '2026-07-18T00:00:00.000Z',
    })
    expect(pkg.status).toBe('DELIVERABLE-SNAPSHOT')
  })
})
