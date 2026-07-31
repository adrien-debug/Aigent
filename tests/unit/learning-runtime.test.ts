/**
 * learning-runtime.test.ts — offline coverage for the H-Supervised health
 * probe (`learning-runtime.ts`). No network: `global.fetch` is stubbed per
 * test, same idiom as `binance-market-provider.test.ts`.
 *
 * Covers the issue's mandatory cases: not_configured (no fetch attempted at
 * all), unavailable (timeout / network / HTTP error, each distinguished),
 * partial (incomplete payload), live (real capabilities), and the token
 * secrecy invariant (never in `endpoint`, never in `detail`, never anywhere
 * in the serialized result).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getLearningRuntimeHealth,
  LEARNING_RUNTIME_TIMEOUT_MS,
} from '@/lib/agent-mission-control/learning-runtime'

const originalFetch = global.fetch
const ORIGINAL_URL = process.env.AIGENT_LEARNING_RUNTIME_URL
const ORIGINAL_TOKEN = process.env.AIGENT_LEARNING_RUNTIME_TOKEN
const SECRET_TOKEN = 'sekret-learning-token-do-not-leak'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function clearConfig(): void {
  delete process.env.AIGENT_LEARNING_RUNTIME_URL
  delete process.env.AIGENT_LEARNING_RUNTIME_TOKEN
}

function setConfig(): void {
  process.env.AIGENT_LEARNING_RUNTIME_URL = 'https://learning.internal.example'
  process.env.AIGENT_LEARNING_RUNTIME_TOKEN = SECRET_TOKEN
}

describe('getLearningRuntimeHealth', () => {
  beforeEach(() => {
    clearConfig()
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
    if (ORIGINAL_URL === undefined) delete process.env.AIGENT_LEARNING_RUNTIME_URL
    else process.env.AIGENT_LEARNING_RUNTIME_URL = ORIGINAL_URL
    if (ORIGINAL_TOKEN === undefined) delete process.env.AIGENT_LEARNING_RUNTIME_TOKEN
    else process.env.AIGENT_LEARNING_RUNTIME_TOKEN = ORIGINAL_TOKEN
  })

  it('returns not_configured and attempts NO fetch when env is unset', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const health = await getLearningRuntimeHealth()

    expect(health.status).toBe('not_configured')
    expect(health.capabilities).toBeNull()
    expect(health.endpoint).toBeNull()
    expect(health.latencyMs).toBeNull()
    expect(health.detail).not.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns unavailable with an attributed detail on HTTP error status', async () => {
    setConfig()
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(500, { error: 'boom' })) as unknown as typeof fetch

    const health = await getLearningRuntimeHealth()

    expect(health.status).toBe('unavailable')
    expect(health.capabilities).toBeNull()
    expect(health.detail).toContain('500')
  })

  it('returns unavailable with a network-error detail when fetch rejects', async () => {
    setConfig()
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch

    const health = await getLearningRuntimeHealth()

    expect(health.status).toBe('unavailable')
    expect(health.detail).toMatch(/network/i)
  })

  it('returns unavailable with a timeout-specific detail on abort', async () => {
    setConfig()
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    }) as unknown as typeof fetch

    const promise = getLearningRuntimeHealth()
    // Nothing to fake-advance here (no vi.useFakeTimers — AbortController's
    // own real setTimeout drives this); await directly, bounded by the
    // module's own LEARNING_RUNTIME_TIMEOUT_MS so this test still terminates.
    const health = await promise

    expect(health.status).toBe('unavailable')
    expect(health.detail).toMatch(/timeout/i)
    expect(health.detail).toContain(String(LEARNING_RUNTIME_TIMEOUT_MS))
  }, LEARNING_RUNTIME_TIMEOUT_MS + 2_000)

  it('returns partial when the 2xx payload is missing capabilities', async () => {
    setConfig()
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'ok' })) as unknown as typeof fetch

    const health = await getLearningRuntimeHealth()

    expect(health.status).toBe('partial')
    expect(health.capabilities).toBeNull()
    expect(health.detail).not.toBeNull()
  })

  it('returns live with real capabilities on a complete 2xx payload', async () => {
    setConfig()
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { capabilities: ['train', 'evaluate'] })) as unknown as typeof fetch

    const health = await getLearningRuntimeHealth()

    expect(health.status).toBe('live')
    expect(health.capabilities).toEqual(['train', 'evaluate'])
    expect(health.detail).toBeNull()
    expect(health.endpoint).toBe('https://learning.internal.example')
  })

  it('never leaks the token into endpoint, detail, or the serialized result', async () => {
    setConfig()
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(500, { error: 'boom' })) as unknown as typeof fetch

    const health = await getLearningRuntimeHealth()
    const serialized = JSON.stringify(health)

    expect(serialized).not.toContain(SECRET_TOKEN)
    expect(health.endpoint).not.toContain(SECRET_TOKEN)
    expect(health.detail ?? '').not.toContain(SECRET_TOKEN)
  })
})
