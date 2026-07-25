/**
 * AIGENT-FACTORY-SHADOW-REPLAY-001 — promotion-policy resolver tests.
 * Deterministic + offline: pgrest mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

let pgResponse: unknown[] | (() => unknown[] | never)

vi.mock('@/lib/agent-mission-control/postgrest', () => {
  class MockPgrestError extends Error {
    status = 500
  }
  return {
    PgrestError: MockPgrestError,
    pgrest: vi.fn(async () => {
      if (typeof pgResponse === 'function') return (pgResponse as () => unknown[])()
      return pgResponse
    }),
  }
})

import { resolvePromotionPolicy } from '@/lib/agent-mission-control/promotion-policy'

beforeEach(() => {
  pgResponse = []
})

describe('resolvePromotionPolicy', () => {
  it('requires_shadow_replay=true → strict policy (both required)', async () => {
    pgResponse = [{ requires_shadow_replay: true }]
    const r = await resolvePromotionPolicy('copilot-1')
    expect(r.source).toBe('strict-opt-in')
    expect(r.policy).toEqual({ requireShadow: true, requireReplay: true })
  })

  it('requires_shadow_replay=false → explicit opt-out, lenient default', async () => {
    pgResponse = [{ requires_shadow_replay: false }]
    const r = await resolvePromotionPolicy('copilot-1')
    expect(r.source).toBe('explicit-opt-out')
    expect(r.policy).toEqual({ requireShadow: false, requireReplay: false })
  })

  it('requires_shadow_replay=null (pre-cutover row) → grandfathered, lenient default, but the source is distinguishable from an opt-out', async () => {
    pgResponse = [{ requires_shadow_replay: null }]
    const r = await resolvePromotionPolicy('copilot-1')
    expect(r.source).toBe('grandfathered-null')
    expect(r.policy).toEqual({ requireShadow: false, requireReplay: false })
  })

  it('copilot row missing entirely → fail-closed STRICT, never a silent lenient fallback', async () => {
    pgResponse = []
    const r = await resolvePromotionPolicy('copilot-ghost')
    expect(r.source).toBe('undeterminable-fail-closed')
    expect(r.policy).toEqual({ requireShadow: true, requireReplay: true })
  })

  it('pgrest throws (upstream failure) → fail-closed STRICT, never a silent lenient fallback', async () => {
    pgResponse = () => {
      throw new Error('upstream down')
    }
    const r = await resolvePromotionPolicy('copilot-1')
    expect(r.source).toBe('undeterminable-fail-closed')
    expect(r.policy).toEqual({ requireShadow: true, requireReplay: true })
  })
})
