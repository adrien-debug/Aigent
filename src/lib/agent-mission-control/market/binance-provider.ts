import 'server-only'

import { guardedFetch } from '../../../langgraph/http-guard.mjs'
import {
  BaseMarketProvider,
  type ProviderContext,
  type ProviderResult,
} from './provider'
import type {
  Candle,
  CandleInterval,
  PairSymbol,
  Ticker,
} from './snapshot'
import { makeProvenance, unavailableProvenance } from './truth'

const BINANCE_BASE_URL = 'https://api.binance.com'
const BINANCE_HOST = 'api.binance.com'
export const BINANCE_FUTURES_BASE_URL = 'https://fapi.binance.com'
export const BINANCE_FUTURES_HOST = 'fapi.binance.com'
const REQUEST_TIMEOUT_MS = 4_000
const MAX_CACHE_ENTRIES = 128
const TICKER_TTL_MS = 7_000
const ORDER_BOOK_TTL_MS = 7_000

type CachedEntry = { expiresAt: number; value: FetchOutcome }
export type BinanceFetchOutcome =
  | { ok: true; body: unknown; sourceTimestamp: number; fetchedAt: number }
  | { ok: false; reason: string }
type FetchOutcome = BinanceFetchOutcome

const responseCache = new Map<string, CachedEntry>()
const inflight = new Map<string, Promise<FetchOutcome>>()

function candleTtl(interval: CandleInterval): number {
  if (interval === '1m' || interval === '5m') return 30_000
  if (interval === '15m') return 45_000
  return 60_000
}

function cacheSet(key: string, value: FetchOutcome, ttlMs: number): void {
  if (!value.ok) return
  if (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = responseCache.keys().next().value as string | undefined
    if (oldest) responseCache.delete(oldest)
  }
  responseCache.set(key, { expiresAt: Date.now() + ttlMs, value })
}

export async function cachedBinanceJson(
  path: string,
  ttlMs: number,
  target: { baseUrl: string; host: string } = {
    baseUrl: BINANCE_BASE_URL,
    host: BINANCE_HOST,
  },
): Promise<BinanceFetchOutcome> {
  const cacheKey = `${target.baseUrl}${path}`
  const cached = responseCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  if (cached) responseCache.delete(cacheKey)

  const pending = inflight.get(cacheKey)
  if (pending) return pending

  const request: Promise<FetchOutcome> = (async (): Promise<FetchOutcome> => {
    let lastReason = 'Binance request failed'
    for (let attempt = 0; attempt < 2; attempt++) {
      const fetchedAt = Date.now()
      const result = await guardedFetch(`${target.baseUrl}${path}`, {
        allowedHosts: [target.host],
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: { accept: 'application/json' },
        readBody: async (response) => ({
          json: response.ok ? await response.json() : null,
          date: response.headers.get('date'),
        }),
      })
      if (result.ok && result.httpOk) {
        const wrapped = result.body as { json: unknown; date: string | null }
        const headerTimestamp = wrapped.date ? Date.parse(wrapped.date) : Number.NaN
        const value: FetchOutcome = {
          ok: true,
          body: wrapped.json,
          sourceTimestamp: Number.isFinite(headerTimestamp) ? headerTimestamp : fetchedAt,
          fetchedAt,
        }
        cacheSet(cacheKey, value, ttlMs)
        return value
      }
      lastReason = result.ok ? `Binance HTTP ${result.status}` : result.reason
    }
    return { ok: false, reason: lastReason }
  })()

  inflight.set(cacheKey, request)
  try {
    return await request
  } finally {
    inflight.delete(cacheKey)
  }
}

function unavailable<T>(path: string, ctx: ProviderContext, reason: string): ProviderResult<T> {
  console.error(`[market/binance] ${path} unavailable: ${reason}`)
  return {
    value: null,
    provenance: unavailableProvenance({
      source: `binance-spot:${path}`,
      sourceType: 'binance',
      asOf: ctx.asOf,
      reason,
    }),
  }
}

export class BinanceMarketProvider extends BaseMarketProvider {
  readonly id = 'binance-spot'
  readonly sourceType = 'binance' as const

  async getCandles(
    pair: PairSymbol,
    interval: CandleInterval,
    limit: number,
    ctx: ProviderContext,
  ): Promise<ProviderResult<Candle[]>> {
    const boundedLimit = Math.min(Math.max(limit, 2), 100)
    const path = `/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${boundedLimit}`
    const result = await cachedBinanceJson(path, candleTtl(interval))
    if (!result.ok) return unavailable(path, ctx, result.reason)
    if (!Array.isArray(result.body) || result.body.length === 0) {
      return unavailable(path, ctx, `Binance returned no candles for ${pair} ${interval}`)
    }
    const candles = result.body.flatMap((row): Candle[] => {
      if (!Array.isArray(row) || row.length < 7) return []
      return [{
        openTime: Number(row[0]),
        open: String(row[1]),
        high: String(row[2]),
        low: String(row[3]),
        close: String(row[4]),
        volume: String(row[5]),
        closeTime: Number(row[6]),
        interval,
      }]
    })
    if (candles.length === 0) return unavailable(path, ctx, 'Binance candle payload was invalid')
    return {
      value: candles,
      provenance: makeProvenance({
        source: `binance-spot:${path}`,
        sourceType: 'binance',
        truth: 'LIVE',
        dataTimestamp: result.sourceTimestamp,
        asOf: ctx.asOf,
        maxAgeMs: ctx.maxAgeMs,
        confidence: 1,
      }),
    }
  }

  async getTicker(pair: PairSymbol, ctx: ProviderContext): Promise<ProviderResult<Ticker>> {
    const path = `/api/v3/ticker/24hr?symbol=${pair}`
    const result = await cachedBinanceJson(path, TICKER_TTL_MS)
    if (!result.ok) return unavailable(path, ctx, result.reason)
    const row = result.body as Record<string, unknown>
    if (!row || typeof row !== 'object' || typeof row.lastPrice !== 'string') {
      return unavailable(path, ctx, 'Binance ticker payload was invalid')
    }
    const sourceTimestamp = Number(row.closeTime)
    return {
      value: {
        last: row.lastPrice,
        bid: typeof row.bidPrice === 'string' ? row.bidPrice : null,
        ask: typeof row.askPrice === 'string' ? row.askPrice : null,
        high24h: typeof row.highPrice === 'string' ? row.highPrice : null,
        low24h: typeof row.lowPrice === 'string' ? row.lowPrice : null,
        volume24h: typeof row.volume === 'string' ? row.volume : null,
        changePercent24h:
          typeof row.priceChangePercent === 'string' ? row.priceChangePercent : null,
        quote: pair.endsWith('USDC') ? 'USDC' : 'USDT',
        sourceTimestamp: Number.isFinite(sourceTimestamp)
          ? sourceTimestamp
          : result.sourceTimestamp,
        fetchedAt: result.fetchedAt,
      },
      provenance: makeProvenance({
        source: `binance-spot:${path}`,
        sourceType: 'binance',
        truth: 'LIVE',
        dataTimestamp: Number.isFinite(sourceTimestamp)
          ? sourceTimestamp
          : result.sourceTimestamp,
        asOf: ctx.asOf,
        maxAgeMs: ctx.maxAgeMs,
        confidence: 1,
      }),
    }
  }

  async getOrderBook(
    pair: PairSymbol,
    depth: number,
    ctx: ProviderContext,
  ): Promise<ProviderResult<{
    bids: [string, string][]
    asks: [string, string][]
    sourceTimestamp?: number
    fetchedAt?: number
    lastUpdateId?: number
  }>> {
    const boundedDepth = Math.min(Math.max(depth, 5), 100)
    const path = `/api/v3/depth?symbol=${pair}&limit=${boundedDepth}`
    const result = await cachedBinanceJson(path, ORDER_BOOK_TTL_MS)
    if (!result.ok) return unavailable(path, ctx, result.reason)
    const row = result.body as Record<string, unknown>
    if (!Array.isArray(row?.bids) || !Array.isArray(row?.asks)) {
      return unavailable(path, ctx, 'Binance order-book payload was invalid')
    }
    return {
      value: {
        bids: row.bids as [string, string][],
        asks: row.asks as [string, string][],
        sourceTimestamp: result.sourceTimestamp,
        fetchedAt: result.fetchedAt,
        lastUpdateId: Number(row.lastUpdateId),
      },
      provenance: makeProvenance({
        source: `binance-spot:${path}`,
        sourceType: 'binance',
        truth: 'LIVE',
        dataTimestamp: result.sourceTimestamp,
        asOf: ctx.asOf,
        maxAgeMs: ctx.maxAgeMs,
        confidence: 1,
      }),
    }
  }
}

export function clearBinanceMarketCache(): void {
  responseCache.clear()
  inflight.clear()
}
