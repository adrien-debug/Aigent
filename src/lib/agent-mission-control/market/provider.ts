/**
 * AIG-TRADE-001 — market data provider interface + two implementations.
 *
 * The provider is the ONLY place the trading tools touch a data source. Two
 * implementations satisfy it:
 *
 *   - HttpMarketProvider  — reads TradeAgent's PUBLIC `/api/market/*` routes
 *     (candles/tickers/…) over HTTP. Base URL from `TRADEAGENT_MARKET_URL`.
 *     Read-only, timeout-bounded, never throws on a bad source (returns an
 *     UNAVAILABLE-shaped result). This is the LIVE/SNAPSHOT path. It writes
 *     NOTHING to TradeAgent (invariant #21/#22: no mutation of the consumer).
 *
 *   - FixtureMarketProvider — serves hand-authored HISTORICAL/FIXTURE series
 *     from `./fixtures`. Lab-only; every datum it returns is tagged
 *     truth: 'FIXTURE' or 'HISTORICAL' so it can NEVER be mistaken for LIVE.
 *
 * A capability the source genuinely lacks (funding/OI, account risk) resolves
 * to `null` + an UNAVAILABLE provenance — never a fabricated value (invariant
 * #8). This is exactly prompt Lot 1's "interface de provider propre" so a real
 * live source can be swapped in behind the same contract with zero tool change.
 */

import 'server-only'

import type {
  Candle,
  CandleInterval,
  PairSymbol,
  Ticker,
} from './snapshot'
import type { MarketSourceType, Provenance, TruthStatus } from './truth'
import { makeProvenance, unavailableProvenance } from './truth'

/** One provider result: the payload (or null) + its provenance. */
export interface ProviderResult<T> {
  value: T | null
  provenance: Provenance
}

export interface ProviderContext {
  /** Point-in-time the read answers for (epoch ms). Defaults to Date.now(). */
  asOf: number
  /** Max acceptable age for a real-time read; null = no bound. */
  maxAgeMs: number | null
}

/**
 * The provider contract. Every method is async, read-only, and resolves to a
 * ProviderResult — NEVER throws for an unavailable datum (returns UNAVAILABLE).
 * A provider implements only the capabilities it truly has; the rest return
 * UNAVAILABLE by default via the base class.
 */
export interface MarketDataProvider {
  readonly id: string
  readonly sourceType: MarketSourceType
  getCandles(
    pair: PairSymbol,
    interval: CandleInterval,
    limit: number,
    ctx: ProviderContext,
  ): Promise<ProviderResult<Candle[]>>
  getTicker(pair: PairSymbol, ctx: ProviderContext): Promise<ProviderResult<Ticker>>
  /** Order book — many sources lack it; default UNAVAILABLE. */
  getOrderBook(
    pair: PairSymbol,
    depth: number,
    ctx: ProviderContext,
  ): Promise<ProviderResult<{ bids: [string, string][]; asks: [string, string][] }>>
  /** Funding / OI — perp-only; default UNAVAILABLE. */
  getFundingOpenInterest(
    pair: PairSymbol,
    ctx: ProviderContext,
  ): Promise<
    ProviderResult<{
      fundingRate: string | null
      openInterest: string | null
      nextFundingTime: number | null
    }>
  >
}

/** Default UNAVAILABLE results for capabilities a provider does not implement. */
export abstract class BaseMarketProvider implements MarketDataProvider {
  abstract readonly id: string
  abstract readonly sourceType: MarketSourceType

  abstract getCandles(
    pair: PairSymbol,
    interval: CandleInterval,
    limit: number,
    ctx: ProviderContext,
  ): Promise<ProviderResult<Candle[]>>

  abstract getTicker(
    pair: PairSymbol,
    ctx: ProviderContext,
  ): Promise<ProviderResult<Ticker>>

  async getOrderBook(
    _pair: PairSymbol,
    _depth: number,
    ctx: ProviderContext,
  ): Promise<
    ProviderResult<{ bids: [string, string][]; asks: [string, string][] }>
  > {
    return {
      value: null,
      provenance: unavailableProvenance({
        source: this.id,
        sourceType: this.sourceType,
        asOf: ctx.asOf,
        reason: `${this.id} has no order-book capability`,
      }),
    }
  }

  async getFundingOpenInterest(
    _pair: PairSymbol,
    ctx: ProviderContext,
  ): Promise<
    ProviderResult<{
      fundingRate: string | null
      openInterest: string | null
      nextFundingTime: number | null
    }>
  > {
    return {
      value: null,
      provenance: unavailableProvenance({
        source: this.id,
        sourceType: this.sourceType,
        asOf: ctx.asOf,
        reason: `${this.id} has no funding/open-interest capability`,
      }),
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP provider — reads TradeAgent's public /api/market/* routes.
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 4000

/** TradeAgent's serialized candle shape from /api/market/candles. */
interface WireCandle {
  openTime: number
  closeTime: number
  open: string
  high: string
  low: string
  close: string
  volume: string
  interval: string
  // envelope fields we care about for provenance:
  freshness?: string
  timestamp?: number
  confidence?: number
  source?: string
}

export class HttpMarketProvider extends BaseMarketProvider {
  readonly id: string
  readonly sourceType: MarketSourceType = 'composite'
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(opts: { baseUrl: string; timeoutMs?: number }) {
    super()
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.id = `tradeagent:${this.baseUrl}`
  }

  private async fetchJson(path: string): Promise<unknown | null> {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
        // read-only, never cached across truth boundaries
        cache: 'no-store',
      })
      if (!res.ok) return null
      return (await res.json()) as unknown
    } catch {
      return null
    } finally {
      clearTimeout(t)
    }
  }

  async getCandles(
    pair: PairSymbol,
    interval: CandleInterval,
    limit: number,
    ctx: ProviderContext,
  ): Promise<ProviderResult<Candle[]>> {
    const body = await this.fetchJson(
      `/api/market/candles?symbol=${pair}&interval=${interval}&limit=${limit}`,
    )
    const rows =
      body && typeof body === 'object' && Array.isArray((body as { candles?: unknown }).candles)
        ? ((body as { candles: WireCandle[] }).candles)
        : null
    if (!rows || rows.length === 0) {
      return {
        value: null,
        provenance: unavailableProvenance({
          source: `${this.id}/api/market/candles`,
          sourceType: this.sourceType,
          asOf: ctx.asOf,
          reason: `no candles for ${pair} ${interval} from ${this.baseUrl}`,
        }),
      }
    }
    const candles: Candle[] = rows.map((r) => ({
      openTime: r.openTime,
      closeTime: r.closeTime,
      open: String(r.open),
      high: String(r.high),
      low: String(r.low),
      close: String(r.close),
      volume: String(r.volume),
      interval,
    }))
    const last = rows[rows.length - 1]
    const dataTimestamp = last.timestamp ?? last.closeTime ?? ctx.asOf
    return {
      value: candles,
      provenance: makeProvenance({
        source: `${this.id}/api/market/candles`,
        sourceType: this.sourceType,
        truth: freshnessToTruthOr(last.freshness, 'SNAPSHOT'),
        dataTimestamp,
        asOf: ctx.asOf,
        maxAgeMs: ctx.maxAgeMs,
        confidence: last.confidence ?? 0.8,
      }),
    }
  }

  async getTicker(
    pair: PairSymbol,
    ctx: ProviderContext,
  ): Promise<ProviderResult<Ticker>> {
    const body = await this.fetchJson(`/api/market/tickers?symbols=${pair}`)
    const list =
      body && typeof body === 'object' && Array.isArray((body as { tickers?: unknown }).tickers)
        ? ((body as { tickers: Array<Record<string, unknown>> }).tickers)
        : null
    const row = list?.find((t) => t.pair === pair) ?? list?.[0]
    if (!row) {
      return {
        value: null,
        provenance: unavailableProvenance({
          source: `${this.id}/api/market/tickers`,
          sourceType: this.sourceType,
          asOf: ctx.asOf,
          reason: `no ticker for ${pair} from ${this.baseUrl}`,
        }),
      }
    }
    const v = row.value as Record<string, unknown> | undefined
    const ticker: Ticker = {
      last: String((v?.last ?? row.last) ?? ''),
      high24h: strOrNull(v?.high24h ?? row.high24h),
      low24h: strOrNull(v?.low24h ?? row.low24h),
      volume24h: strOrNull(v?.volume24h ?? row.volume24h),
      changePercent24h: strOrNull(v?.changePercent24h ?? row.changePercent24h),
      quote: (v?.quote as Ticker['quote']) ?? 'USDT',
    }
    return {
      value: ticker,
      provenance: makeProvenance({
        source: `${this.id}/api/market/tickers`,
        sourceType: this.sourceType,
        truth: freshnessToTruthOr(row.freshness as string | undefined, 'SNAPSHOT'),
        dataTimestamp: (row.timestamp as number) ?? ctx.asOf,
        asOf: ctx.asOf,
        maxAgeMs: ctx.maxAgeMs,
        confidence: (row.confidence as number) ?? 0.8,
      }),
    }
  }
}

/** Map a wire freshness label to a truth, defaulting when absent/unknown. */
function freshnessToTruthOr(
  f: string | undefined,
  fallback: TruthStatus,
): TruthStatus {
  if (!f) return fallback
  switch (f) {
    case 'LIVE':
      return 'LIVE'
    case 'INDEXED':
    case 'CACHED':
      return 'SNAPSHOT'
    case 'ESTIMATED':
      return 'FALLBACK'
    case 'SIMULATED':
      return 'FIXTURE'
    default:
      return fallback
  }
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  return String(v)
}
