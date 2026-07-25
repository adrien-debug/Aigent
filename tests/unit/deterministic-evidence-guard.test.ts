/**
 * AIGENT-DETERMINISTIC-EVIDENCE-001 — the fail-closed activation guard.
 *
 * The deterministic evidence executor is a $0 fixture path. It must be
 * constructible ONLY in a recognised non-production context and NEVER in
 * production, regardless of how its activation is requested. These tests pin the
 * two-way fail-closed contract:
 *   - production ALWAYS refuses, through every one of the five activation vectors
 *     (env var, API param, manifest, user payload, persisted config) — even when
 *     every non-production opt-in is ALSO set (production wins);
 *   - outside production, only a recognised context (test / CI / explicit opt-in)
 *     is allowed; an unrecognised non-production runtime still refuses.
 *
 * Pure + offline: the guard takes an `env` argument, so no process.env mutation
 * is needed and the assertions are hermetic.
 */
import { describe, expect, it } from 'vitest'

import {
  DeterministicEvidenceForbiddenError,
  assertDeterministicEvidenceAllowed,
  isProductionRuntime,
  resolveEvidenceAdapter,
  type DeterministicActivationSource,
} from '@/lib/agent-mission-control/evidence/guard'
import { makeDeterministicEvidenceAdapter } from '@/lib/agent-mission-control/evidence/deterministic-adapter'
import { liveEvidenceAdapter } from '@/lib/agent-mission-control/evidence/live-adapter'
import { EVIDENCE_MODE_DB_LABEL } from '@/lib/agent-mission-control/evidence/execution-adapter'

/** The five ways a caller could try to switch on the fixture — all refused in prod. */
const ACTIVATION_VECTORS: DeterministicActivationSource[] = ['env', 'api-param', 'manifest', 'payload', 'config']

/** A production env with EVERY non-prod opt-in ALSO set — production must still win. */
const PROD_WITH_ALL_OPT_INS = {
  NODE_ENV: 'production',
  VITEST: 'true',
  CI: 'true',
  AIGENT_DETERMINISTIC_EVIDENCE: 'allow',
} as const

describe('isProductionRuntime — fail-closed', () => {
  it('production is production', () => {
    expect(isProductionRuntime({ NODE_ENV: 'production' })).toBe(true)
  })
  it('an UNSET / unknown NODE_ENV is treated as production (fail-closed)', () => {
    expect(isProductionRuntime({})).toBe(true)
    expect(isProductionRuntime({ NODE_ENV: 'staging' })).toBe(true)
  })
  it('only the two known non-production values are non-production', () => {
    expect(isProductionRuntime({ NODE_ENV: 'development' })).toBe(false)
    expect(isProductionRuntime({ NODE_ENV: 'test' })).toBe(false)
  })
})

describe('assertDeterministicEvidenceAllowed — production refuses every activation vector (case 12)', () => {
  for (const vector of ACTIVATION_VECTORS) {
    it(`refuses activation via ${vector} in production, even with every opt-in set`, () => {
      expect(() => assertDeterministicEvidenceAllowed(vector, PROD_WITH_ALL_OPT_INS)).toThrow(
        DeterministicEvidenceForbiddenError
      )
    })
  }

  it('the thrown error records WHICH vector was refused', () => {
    try {
      assertDeterministicEvidenceAllowed('payload', PROD_WITH_ALL_OPT_INS)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(DeterministicEvidenceForbiddenError)
      expect((err as DeterministicEvidenceForbiddenError).source).toBe('payload')
    }
  })
})

describe('assertDeterministicEvidenceAllowed — non-production contexts', () => {
  it('allows a test run (VITEST)', () => {
    expect(() => assertDeterministicEvidenceAllowed('test', { NODE_ENV: 'development', VITEST: 'true' })).not.toThrow()
  })
  it('allows a test run (NODE_ENV=test)', () => {
    expect(() => assertDeterministicEvidenceAllowed('test', { NODE_ENV: 'test' })).not.toThrow()
  })
  it('allows CI', () => {
    expect(() => assertDeterministicEvidenceAllowed('proof-script', { NODE_ENV: 'development', CI: 'true' })).not.toThrow()
  })
  it('allows an explicit local/proof-script opt-in', () => {
    expect(() =>
      assertDeterministicEvidenceAllowed('proof-script', { NODE_ENV: 'development', AIGENT_DETERMINISTIC_EVIDENCE: 'allow' })
    ).not.toThrow()
  })
  it('REFUSES an unrecognised non-production runtime (no opt-in) — fail-closed', () => {
    expect(() => assertDeterministicEvidenceAllowed('env', { NODE_ENV: 'development' })).toThrow(
      DeterministicEvidenceForbiddenError
    )
  })
})

describe('makeDeterministicEvidenceAdapter — cannot even be CONSTRUCTED in production', () => {
  it('throws in production regardless of opt-ins', () => {
    expect(() =>
      makeDeterministicEvidenceAdapter({ scenarios: [], env: PROD_WITH_ALL_OPT_INS })
    ).toThrow(DeterministicEvidenceForbiddenError)
  })
  it('constructs in a test context and self-labels as a fixture', () => {
    const adapter = makeDeterministicEvidenceAdapter({ scenarios: [], env: { NODE_ENV: 'test' } })
    expect(adapter.mode).toBe('deterministic')
    expect(adapter.label).toBe(EVIDENCE_MODE_DB_LABEL.deterministic)
    expect(adapter.label).not.toBe(EVIDENCE_MODE_DB_LABEL.live)
  })
})

describe('resolveEvidenceAdapter — the single chokepoint every vector funnels through', () => {
  it('live is always available, no guard', () => {
    const a = resolveEvidenceAdapter({
      requested: 'live',
      source: 'api-param',
      live: liveEvidenceAdapter,
      makeDeterministic: () => makeDeterministicEvidenceAdapter({ scenarios: [], env: { NODE_ENV: 'test' } }),
      env: PROD_WITH_ALL_OPT_INS,
    })
    expect(a.mode).toBe('live')
  })

  for (const vector of ACTIVATION_VECTORS) {
    it(`a deterministic request via ${vector} is refused in production`, () => {
      expect(() =>
        resolveEvidenceAdapter({
          requested: 'deterministic',
          source: vector,
          live: liveEvidenceAdapter,
          makeDeterministic: () => makeDeterministicEvidenceAdapter({ scenarios: [], env: { NODE_ENV: 'test' } }),
          env: PROD_WITH_ALL_OPT_INS,
        })
      ).toThrow(DeterministicEvidenceForbiddenError)
    })
  }

  it('a deterministic request is honoured in a test context', () => {
    const a = resolveEvidenceAdapter({
      requested: 'deterministic',
      source: 'proof-script',
      live: liveEvidenceAdapter,
      makeDeterministic: () => makeDeterministicEvidenceAdapter({ scenarios: [], env: { NODE_ENV: 'test' } }),
      env: { NODE_ENV: 'test' },
    })
    expect(a.mode).toBe('deterministic')
    expect(a.label).toBe(EVIDENCE_MODE_DB_LABEL.deterministic)
  })
})
