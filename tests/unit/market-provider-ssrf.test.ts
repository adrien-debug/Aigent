/**
 * SSRF guard for HttpMarketProvider (src/lib/agent-mission-control/market/provider.ts).
 *
 * Mirrors the guard `http_get` applies in src/langgraph/tool-registry.mjs:
 * the configured base URL is validated (http/https only) at construction and
 * its host is PINNED as the sole allowed destination; redirects are followed
 * manually with the target host re-validated on every hop. Any rejection
 * fails CLOSED — no network call for a bad config, no fetch to a disallowed
 * redirect host — and always resolves to an UNAVAILABLE-shaped
 * ProviderResult, never a throw and never a fabricated value.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HttpMarketProvider } from '@/lib/agent-mission-control/market/provider'

const ctx = { asOf: Date.now(), maxAgeMs: null }

describe('HttpMarketProvider SSRF guard', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('accepts a valid http/https base URL and reaches fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ tickers: [{ pair: 'ETHUSDT', last: '3500.00' }] }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new HttpMarketProvider({ baseUrl: 'https://tradeagent.example.com' })
    const result = await provider.getTicker('ETHUSDT', ctx)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe('https://tradeagent.example.com/api/market/tickers?symbols=ETHUSDT')
    expect(calledInit.redirect).toBe('manual')
    expect(result.value).not.toBeNull()
    expect(result.value?.last).toBe('3500.00')
    expect(result.provenance.truth).not.toBe('UNAVAILABLE')
  })

  it('rejects a non-http(s) scheme without ever calling fetch — UNAVAILABLE, not a throw', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new HttpMarketProvider({ baseUrl: 'file:///etc/passwd' })

    const ticker = await provider.getTicker('ETHUSDT', ctx)
    expect(ticker.value).toBeNull()
    expect(ticker.provenance.truth).toBe('UNAVAILABLE')
    expect(ticker.provenance.unavailableReason).toMatch(/scheme must be http or https/i)

    const candles = await provider.getCandles('ETHUSDT', '1h', 10, ctx)
    expect(candles.value).toBeNull()
    expect(candles.provenance.truth).toBe('UNAVAILABLE')
    expect(candles.provenance.unavailableReason).toMatch(/scheme must be http or https/i)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an unparseable base URL without calling fetch — UNAVAILABLE, not a throw', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new HttpMarketProvider({ baseUrl: 'not a url at all' })
    const result = await provider.getTicker('ETHUSDT', ctx)

    expect(result.value).toBeNull()
    expect(result.provenance.truth).toBe('UNAVAILABLE')
    expect(result.provenance.unavailableReason).toMatch(/not a parseable absolute URL/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('blocks a redirect to a host outside the configured base — UNAVAILABLE, second hop never fetched', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: new Headers({ location: 'http://169.254.169.254/latest/meta-data/' }),
      json: async () => ({}),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new HttpMarketProvider({ baseUrl: 'https://tradeagent.example.com' })
    const result = await provider.getTicker('ETHUSDT', ctx)

    expect(result.value).toBeNull()
    expect(result.provenance.truth).toBe('UNAVAILABLE')
    expect(result.provenance.unavailableReason).toMatch(/redirect to disallowed host/i)
    expect(result.provenance.unavailableReason).toMatch(/169\.254\.169\.254/)
    // Only the first hop was fetched — the disallowed hop is never followed.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('follows a redirect that stays on the pinned host', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 302,
        headers: new Headers({ location: 'https://tradeagent.example.com/api/market/tickers?symbols=ETHUSDT&v=2' }),
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ tickers: [{ pair: 'ETHUSDT', last: '3600.00' }] }),
      })
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new HttpMarketProvider({ baseUrl: 'https://tradeagent.example.com' })
    const result = await provider.getTicker('ETHUSDT', ctx)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.value?.last).toBe('3600.00')
    expect(result.provenance.truth).not.toBe('UNAVAILABLE')
  })

  it('gives up after too many redirect hops — UNAVAILABLE, never a throw', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 307,
      headers: new Headers({ location: 'https://tradeagent.example.com/api/market/tickers?symbols=ETHUSDT' }),
      json: async () => ({}),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new HttpMarketProvider({ baseUrl: 'https://tradeagent.example.com' })
    const result = await provider.getTicker('ETHUSDT', ctx)

    expect(result.value).toBeNull()
    expect(result.provenance.truth).toBe('UNAVAILABLE')
    expect(result.provenance.unavailableReason).toMatch(/too many redirects/i)
  })

  it('a network throw from fetch never escapes — resolves to UNAVAILABLE', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new HttpMarketProvider({ baseUrl: 'https://tradeagent.example.com' })
    await expect(provider.getTicker('ETHUSDT', ctx)).resolves.toMatchObject({
      value: null,
      provenance: { truth: 'UNAVAILABLE' },
    })
  })
})
