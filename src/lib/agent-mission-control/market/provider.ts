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
 *     SSRF-gated by the SHARED guard in `src/langgraph/http-guard.mjs` — the
 *     same module `http_get` uses, so the two paths cannot drift again: the
 *     configured URL is validated (http/https only) at construction and its
 *     host is PINNED as the sole allowed destination (`allowedHosts: [host]`,
 *     the one-host case of the guard's allowlist parameter); redirects are
 *     followed manually with scheme + host re-validated against that pin on
 *     every hop, so a compromised/misrouted TradeAgent instance can never 302
 *     the fetch onto an internal target (cloud metadata, admin panel, …). Any
 *     rejection fails CLOSED — no network call, UNAVAILABLE provenance, never
 *     a throw.
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
import { guardedFetch, validateHttpUrl } from '../../../langgraph/http-guard.mjs'
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

/** One `fetchJson` outcome: the parsed body, or a typed reason it was refused
 * / failed — NEVER a throw. Lets callers build a specific UNAVAILABLE reason
 * instead of a generic "no data" message. */
type FetchOutcome = { ok: true; body: unknown } | { ok: false; reason: string }

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
  /** SSRF pin: the ONLY host any request (including redirect hops) may ever
   * reach. Null when the configured URL failed validation — every fetch then
   * fails closed without touching the network. Set once at construction so
   * the class never re-derives trust from an attacker-influenced value. */
  private readonly allowedHost: string | null
  private readonly configError: string | null

  constructor(opts: { baseUrl: string; timeoutMs?: number }) {
    super()
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.id = `tradeagent:${this.baseUrl}`
    // SSRF guard, config validation (shared module, `allowedHosts: null` = check
    // the scheme, then let US derive the pin from the accepted URL). Rejects a
    // bad scheme or an unparseable URL up front — never throws, just disables
    // this instance's network path (see fetchJson) so every call resolves to
    // UNAVAILABLE instead.
    const validated = validateHttpUrl(this.baseUrl)
    this.allowedHost = validated.ok ? validated.host : null
    this.configError = validated.ok
      ? null
      : `invalid TRADEAGENT_MARKET_URL: ${validated.reason}`
  }

  private async fetchJson(path: string): Promise<FetchOutcome> {
    // FAIL CLOSED: a rejected config never reaches the network.
    if (!this.allowedHost) {
      return { ok: false, reason: this.configError ?? 'invalid TRADEAGENT_MARKET_URL' }
    }
    // SSRF guard — SHARED with `http_get` via src/langgraph/http-guard.mjs.
    // The pin is expressed as the one-host case of the guard's allowlist:
    // scheme + host are re-validated on every redirect hop, so a compromised
    // or misconfigured TradeAgent instance can never 302 this fetch onto an
    // internal target. The guard never throws — every failure below is a
    // typed reason the caller turns into an UNAVAILABLE provenance.
    const out = await guardedFetch(`${this.baseUrl}${path}`, {
      allowedHosts: [this.allowedHost],
      timeoutMs: this.timeoutMs,
      headers: { accept: 'application/json' },
      // Non-2xx bodies are never parsed: the status IS the answer, and an
      // error page is rarely JSON. Keeps the reason `HTTP <status>` rather
      // than a misleading parse error.
      readBody: async (res) => (res.ok ? ((await res.json()) as unknown) : null),
    })
    if (!out.ok) return { ok: false, reason: out.reason }
    if (!out.httpOk) {
      return { ok: false, reason: `HTTP ${out.status} from ${this.baseUrl}${path}` }
    }
    return { ok: true, body: out.body }
  }

  async getCandles(
    pair: PairSymbol,
    interval: CandleInterval,
    limit: number,
    ctx: ProviderContext,
  ): Promise<ProviderResult<Candle[]>> {
    const fetched = await this.fetchJson(
      `/api/market/candles?symbol=${pair}&interval=${interval}&limit=${limit}`,
    )
    const body = fetched.ok ? fetched.body : null
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
          reason: fetched.ok
            ? `no candles for ${pair} ${interval} from ${this.baseUrl}`
            : fetched.reason,
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
    const fetched = await this.fetchJson(`/api/market/tickers?symbols=${pair}`)
    const body = fetched.ok ? fetched.body : null
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
          reason: fetched.ok
            ? `no ticker for ${pair} from ${this.baseUrl}`
            : fetched.reason,
        }),
      }
    }
    const v = row.value as Record<string, unknown> | undefined
    const ticker: Ticker = {
      last: String((v?.last ?? row.last) ?? ''),
      bid: strOrNull(v?.bid ?? row.bid),
      ask: strOrNull(v?.ask ?? row.ask),
      high24h: strOrNull(v?.high24h ?? row.high24h),
      low24h: strOrNull(v?.low24h ?? row.low24h),
      volume24h: strOrNull(v?.volume24h ?? row.volume24h),
      changePercent24h: strOrNull(v?.changePercent24h ?? row.changePercent24h),
      quote: (v?.quote as Ticker['quote']) ?? 'USDT',
      sourceTimestamp: (row.timestamp as number) ?? ctx.asOf,
      fetchedAt: ctx.asOf,
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
