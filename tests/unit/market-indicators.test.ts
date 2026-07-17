import { describe, it, expect } from 'vitest'
import {
  computeATR,
  computeStdevReturns,
  computeVolatilityState,
  computeMarketStructure,
} from '@/lib/agent-mission-control/market/indicators'
import { SCENARIOS } from '@/lib/agent-mission-control/market/fixtures/scenarios'

describe('deterministic indicator math', () => {
  it('ATR returns null for a too-short series (never fabricates)', () => {
    expect(computeATR(SCENARIOS.incomplete.candles, 14)).toBeNull()
  })

  it('ATR is positive and stable on a real series', () => {
    const atr = computeATR(SCENARIOS['trend-up'].candles, 14)
    expect(atr).not.toBeNull()
    expect(atr as number).toBeGreaterThan(0)
    // Deterministic: same input → same output.
    expect(computeATR(SCENARIOS['trend-up'].candles, 14)).toBe(atr)
  })

  it('stdev of returns is higher for high-vol than for a tight range', () => {
    const hi = computeStdevReturns(SCENARIOS['high-volatility'].candles, 20)
    const lo = computeStdevReturns(SCENARIOS.range.candles, 20)
    expect(hi).not.toBeNull()
    expect(lo).not.toBeNull()
    expect(hi as number).toBeGreaterThan(lo as number)
  })

  it('volatility regime classifies high-vol above range', () => {
    const hi = computeVolatilityState(SCENARIOS['high-volatility'].candles)
    const range = computeVolatilityState(SCENARIOS.range.candles)
    expect(hi).not.toBeNull()
    expect(range).not.toBeNull()
    expect(Number((hi as { annualizedPct: string }).annualizedPct)).toBeGreaterThan(
      Number((range as { annualizedPct: string }).annualizedPct),
    )
  })

  it('volatility is UNAVAILABLE (null) for a short series', () => {
    expect(computeVolatilityState(SCENARIOS.incomplete.candles)).toBeNull()
  })

  it('market structure detects trend up / down / range', () => {
    expect(computeMarketStructure(SCENARIOS['trend-up'].candles)?.trend).toBe('up')
    expect(computeMarketStructure(SCENARIOS['trend-down'].candles)?.trend).toBe('down')
    expect(computeMarketStructure(SCENARIOS.range.candles)?.trend).toBe('range')
  })

  it('structure produces decimal-string levels (never floats)', () => {
    const s = computeMarketStructure(SCENARIOS['trend-up'].candles)
    expect(s).not.toBeNull()
    for (const level of [...(s!.supports), ...(s!.resistances)]) {
      expect(typeof level).toBe('string')
      expect(level).toMatch(/^\d+\.\d+$/)
    }
  })
})
