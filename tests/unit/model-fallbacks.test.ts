/**
 * Unit tests for model-fallbacks.ts
 * (src/lib/agent-mission-control/model-fallbacks.ts).
 *
 * Pure policy, offline. The fallback rule is deliberately narrow and its
 * failure modes are expensive (a wrong fallback = a run silently served by the
 * wrong/cheap model, or a run that fails closed when it should have degraded).
 * These tests pin every branch: no OpenAI target, judge always-fallback,
 * run/benchmark gated by env flag OR per-request opt-in.
 *
 * The env flag AMC_ALLOW_MODEL_FALLBACKS is read live, so each test that depends
 * on it sets/clears it explicitly and restores it after.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveFallback } from '@/lib/agent-mission-control/model-fallbacks'

const FLAG = 'AMC_ALLOW_MODEL_FALLBACKS'
let savedFlag: string | undefined

beforeEach(() => {
  savedFlag = process.env[FLAG]
  delete process.env[FLAG]
})
afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG]
  else process.env[FLAG] = savedFlag
})

describe('resolveFallback — the only fallback target is OpenAI', () => {
  it('returns null when OpenAI is unavailable, whatever the purpose', () => {
    for (const purpose of ['run', 'judge', 'benchmark', 'architect'] as const) {
      expect(
        resolveFallback({ purpose, originalReason: 'boom', requestOptIn: true, openAiAvailable: false }),
      ).toBeNull()
    }
  })
})

describe('resolveFallback — judge always falls back when OpenAI is available', () => {
  it('judge falls back regardless of opt-in / env flag', () => {
    const decision = resolveFallback({
      purpose: 'judge',
      originalReason: 'provider down',
      openAiAvailable: true,
    })
    expect(decision).not.toBeNull()
    expect(decision!.provider).toBe('openai')
    expect(decision!.model).toMatch(/^gpt-/)
    expect(decision!.reason).toContain('judge fallback')
    expect(decision!.reason).toContain('provider down')
  })
})

describe('resolveFallback — run/benchmark/architect are gated', () => {
  it('fails closed (null) when neither env flag nor request opt-in is set', () => {
    for (const purpose of ['run', 'benchmark', 'architect'] as const) {
      expect(
        resolveFallback({ purpose, originalReason: 'seed model gone', openAiAvailable: true }),
      ).toBeNull()
    }
  })

  it('falls back when the per-request opt-in is true', () => {
    const decision = resolveFallback({
      purpose: 'run',
      originalReason: 'seed model gone',
      requestOptIn: true,
      openAiAvailable: true,
    })
    expect(decision).not.toBeNull()
    expect(decision!.provider).toBe('openai')
    expect(decision!.reason).toContain('run fallback')
  })

  it('falls back when the env flag AMC_ALLOW_MODEL_FALLBACKS=1 is set', () => {
    process.env[FLAG] = '1'
    const decision = resolveFallback({
      purpose: 'benchmark',
      originalReason: 'sdk missing',
      openAiAvailable: true,
    })
    expect(decision).not.toBeNull()
    expect(decision!.provider).toBe('openai')
  })

  it('does NOT fall back when the env flag is any value other than exactly "1"', () => {
    process.env[FLAG] = 'true'
    expect(
      resolveFallback({ purpose: 'run', originalReason: 'x', openAiAvailable: true }),
    ).toBeNull()
    process.env[FLAG] = '0'
    expect(
      resolveFallback({ purpose: 'run', originalReason: 'x', openAiAvailable: true }),
    ).toBeNull()
  })

  it('every fallback decision is explicitly marked with a reason (a run never claims the original model)', () => {
    process.env[FLAG] = '1'
    const decision = resolveFallback({
      purpose: 'run',
      originalReason: 'access denied',
      openAiAvailable: true,
    })
    expect(decision!.reason).toContain('access denied')
    expect(decision!.reason.length).toBeGreaterThan(0)
  })
})
