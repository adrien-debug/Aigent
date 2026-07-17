import { describe, it, expect } from 'vitest'
import {
  OUTPUT_CONTRACTS,
  validateContract,
  type OutputContractName,
} from '@/lib/agent-mission-control/market/contracts'
import {
  VALID_SAMPLES,
  INVALID_SAMPLES,
} from '@/lib/agent-mission-control/market/fixtures/contract-samples'

const NAMES = Object.keys(OUTPUT_CONTRACTS) as OutputContractName[]

describe('output contracts (Lot 3)', () => {
  it('exposes exactly the six mission contracts', () => {
    expect(NAMES.sort()).toEqual(
      [
        'EducationalLesson',
        'ExecutionAssessment',
        'MacroContextReport',
        'QuantRegimeReport',
        'RiskAssessment',
        'TechnicalAnalysisReport',
      ].sort(),
    )
  })

  for (const name of NAMES) {
    it(`${name}: valid sample passes`, () => {
      const r = validateContract(name, VALID_SAMPLES[name])
      expect(r.errors).toEqual([])
      expect(r.ok).toBe(true)
    })

    it(`${name}: each invalid sample is rejected (never coerced)`, () => {
      for (const bad of INVALID_SAMPLES[name]) {
        const r = validateContract(name, bad.payload)
        expect(r.ok, `should reject: ${bad.why}`).toBe(false)
        expect(r.errors.length).toBeGreaterThan(0)
      }
    })
  }

  it('validation never throws on garbage input', () => {
    expect(() => validateContract('RiskAssessment', undefined)).not.toThrow()
    expect(validateContract('RiskAssessment', null).ok).toBe(false)
    expect(validateContract('RiskAssessment', 42).ok).toBe(false)
  })
})
