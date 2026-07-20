import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  BinanceMarketProvider,
  clearBinanceMarketCache,
} from '@/lib/agent-mission-control/market/binance-provider'

const ctx = { asOf: Date.now(), maxAgeMs: 60_000 }
const originalFetch = global.fetch

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ date: new Date(ctx.asOf).toUTCString() }),
    json: async () => body,
  } as Response
}

describe('BinanceMarketProvider', () => {
  afterEach(() => {
    global.fetch = originalFetch
    clearBinanceMarketCache()
    vi.restoreAllMocks()
  })

  it('reads a live ticker with bid/ask and source provenance', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      response({
        lastPrice: '3500.10',
        bidPrice: '3500.00',
        askPrice: '3500.20',
        highPrice: '3600.00',
        lowPrice: '3400.00',
        volume: '12345.67',
        priceChangePercent: '1.25',
        closeTime: ctx.asOf,
      })
    ) as unknown as typeof fetch

    const result = await new BinanceMarketProvider().getTicker('ETHUSDT', ctx)

    expect(result.value).toMatchObject({
      last: '3500.10',
      bid: '3500.00',
      ask: '3500.20',
      volume24h: '12345.67',
    })
    expect(result.provenance).toMatchObject({
      truth: 'LIVE',
      sourceType: 'binance',
      dataTimestamp: ctx.asOf,
    })
  })

  it('deduplicates ticker reads inside the short TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        lastPrice: '3500',
        bidPrice: '3499',
        askPrice: '3501',
        closeTime: ctx.asOf,
      })
    )
    global.fetch = fetchMock as unknown as typeof fetch
    const provider = new BinanceMarketProvider()

    await provider.getTicker('ETHUSDT', ctx)
    await provider.getTicker('ETHUSDT', { ...ctx, asOf: ctx.asOf + 1_000 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('caps candle output at 100 and preserves decimal strings', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      response([
        [ctx.asOf - 60_000, '1', '2', '0.5', '1.5', '42', ctx.asOf, '0', 1],
      ])
    ) as unknown as typeof fetch

    const result = await new BinanceMarketProvider().getCandles('BTCUSDT', '1m', 500, ctx)

    expect(result.value?.[0]).toMatchObject({
      open: '1',
      high: '2',
      low: '0.5',
      close: '1.5',
      volume: '42',
    })
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toContain('limit=100')
  })
})
