import { describe, it, expect } from 'vitest'
import {
  composeCouncil,
  COUNCIL_COMPOSITION,
  COUNCIL_SEATS,
  type CouncilReports,
} from '@/lib/agent-mission-control/market/council'
import { VALID_SAMPLES } from '@/lib/agent-mission-control/market/fixtures/contract-samples'
import type {
  TechnicalAnalysisReport,
  QuantRegimeReport,
  RiskAssessment,
} from '@/lib/agent-mission-control/market/contracts'

// Golden valid reports from the Lot 3 samples, typed for the council seats.
const atlasBase = VALID_SAMPLES.TechnicalAnalysisReport as TechnicalAnalysisReport
const vectorBase = VALID_SAMPLES.QuantRegimeReport as QuantRegimeReport
const sentinelBase = VALID_SAMPLES.RiskAssessment as RiskAssessment

function atlas(lean: 'bullish' | 'bearish'): TechnicalAnalysisReport {
  return { ...atlasBase, conclusion: { ...atlasBase.conclusion, lean } }
}
function vector(lean: 'bullish' | 'bearish'): QuantRegimeReport {
  return { ...vectorBase, conclusion: { ...vectorBase.conclusion, lean } }
}
function sentinel(verdict: RiskAssessment['verdict']): RiskAssessment {
  return { ...sentinelBase, verdict, justification: `sentinel says ${verdict}` }
}

describe('Trading Council (Lot 8)', () => {
  it('exposes the six-seat composition in pipeline order', () => {
    expect(COUNCIL_SEATS).toEqual(['atlas', 'vector', 'meridian', 'pulse', 'sentinel', 'sage'])
    expect(COUNCIL_COMPOSITION.safetySeat).toBe('sentinel')
  })

  it('Sentinel BLOCKED forces finalStance BLOCKED even if Atlas + Vector are bullish', () => {
    const reports: CouncilReports = {
      atlas: atlas('bullish'),
      vector: vector('bullish'),
      sentinel: sentinel('BLOCKED'),
    }
    const result = composeCouncil(reports)
    expect(result.finalStance).toBe('BLOCKED')
    expect(result.sentinelVerdict).toBe('BLOCKED')
    expect(result.rationale).toMatch(/terminal/i)
  })

  it('no majority overrides a safety BLOCK — all bullish members cannot flip it', () => {
    const reports: CouncilReports = {
      atlas: atlas('bullish'),
      vector: vector('bullish'),
      sentinel: sentinel('BLOCKED'),
    }
    // Even with every directional seat bullish, BLOCKED stands.
    expect(composeCouncil(reports).finalStance).toBe('BLOCKED')
  })

  it('conserves divergences — two opposing reports yield a non-empty divergences list', () => {
    const reports: CouncilReports = {
      atlas: atlas('bullish'),
      vector: vector('bearish'),
      sentinel: sentinel('ALLOWED'),
    }
    const result = composeCouncil(reports)
    expect(result.divergences.length).toBeGreaterThan(0)
    const direction = result.divergences.find((d) => d.dimension === 'direction')
    expect(direction).toBeDefined()
    expect(direction!.between).toEqual(['atlas', 'vector'])
    // Both sides kept verbatim — never smoothed into a consensus.
    expect(direction!.positions[0]).toMatch(/bullish/)
    expect(direction!.positions[1]).toMatch(/bearish/)
  })

  it('does not fabricate consensus — genuine agreement yields empty divergences', () => {
    const reports: CouncilReports = {
      atlas: atlas('bullish'),
      vector: vector('bullish'),
      sentinel: sentinel('ALLOWED'),
    }
    const result = composeCouncil(reports)
    // Same direction + ALLOWED ⇒ no fabricated tension, and it is truly ALLOWED.
    expect(result.divergences).toEqual([])
    expect(result.finalStance).toBe('ALLOWED')
  })

  it('INSUFFICIENT when Sentinel is absent — silence on risk is never approval', () => {
    const reports: CouncilReports = { atlas: atlas('bullish'), vector: vector('bullish') }
    const result = composeCouncil(reports)
    expect(result.finalStance).toBe('INSUFFICIENT')
    expect(result.sentinelVerdict).toBeNull()
    expect(result.missing).toContain('sentinel')
  })

  it('Sentinel REDUCE / ALLOWED / UNAVAILABLE map to the right stance', () => {
    expect(composeCouncil({ sentinel: sentinel('REDUCE') }).finalStance).toBe('REDUCE')
    expect(composeCouncil({ sentinel: sentinel('ALLOWED') }).finalStance).toBe('ALLOWED')
    expect(composeCouncil({ sentinel: sentinel('UNAVAILABLE') }).finalStance).toBe('INSUFFICIENT')
  })

  it('records bullish-direction vs Sentinel restraint as a divergence', () => {
    const reports: CouncilReports = { atlas: atlas('bullish'), sentinel: sentinel('REDUCE') }
    const result = composeCouncil(reports)
    const tension = result.divergences.find((d) => d.dimension === 'risk-vs-direction')
    expect(tension).toBeDefined()
    expect(tension!.between).toEqual(['atlas', 'sentinel'])
  })
})
