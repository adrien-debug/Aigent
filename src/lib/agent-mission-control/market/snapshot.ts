/**
 * AIG-TRADE-001 — normalized MarketSnapshot model (Aigent side).
 *
 * The single shape every trading tool returns. It is the mission's answer to
 * prompt Lot 1's "MarketSnapshot normalisé". Every field is provenance-tagged
 * through `Provenance` (truth.ts); prices are lossless decimal strings, never
 * floats. A snapshot NEVER invents a value: a missing block is `null` with a
 * `UNAVAILABLE` provenance recorded in `sources`.
 *
 * The executable universe is deliberately tiny and mirrors TradeAgent's own
 * asset universe (ETH-only trade side; BTC/stables as context). Invariant #14:
 * the executable universe stays exactly what TradeAgent authorises.
 */

import type { Provenance, TruthStatus } from './truth'

/** Base assets we know about. Mirrors TradeAgent `AssetSymbol`. */
export type AssetSymbol = 'BTC' | 'ETH' | 'USDC' | 'USDT' | 'WBTC' | 'WETH'

/** Trading pairs. Mirrors TradeAgent `PairSymbol`. */
export type PairSymbol = 'BTCUSDT' | 'ETHUSDT' | 'ETHUSDC' | 'BTCUSDC'

export const PAIR_SYMBOLS: readonly PairSymbol[] = [
  'BTCUSDT',
  'ETHUSDT',
  'ETHUSDC',
  'BTCUSDC',
]

/**
 * The EXECUTABLE universe TradeAgent authorises (ETH-only on the trade side).
 * BTC pairs are CONTEXT-ONLY here — an agent may read them for correlation but
 * must never present a BTC pair as an actionable instrument (invariant #14).
 */
export const EXECUTABLE_PAIRS: readonly PairSymbol[] = ['ETHUSDT', 'ETHUSDC']

export function isExecutablePair(p: PairSymbol): boolean {
  return EXECUTABLE_PAIRS.includes(p)
}

export type CandleInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d'

export const CANDLE_INTERVALS: readonly CandleInterval[] = [
  '1m',
  '5m',
  '15m',
  '1h',
  '4h',
  '1d',
]

/** OHLCV as lossless decimal strings; times epoch ms. Mirrors TradeAgent Candle. */
export interface Candle {
  openTime: number
  closeTime: number
  open: string
  high: string
  low: string
  close: string
  volume: string
  interval: CandleInterval
}

/** A price observation — decimal string, never a float. */
export interface Price {
  price: string
  quote: AssetSymbol
}

/** 24h ticker. All prices decimal strings. */
export interface Ticker {
  last: string
  bid: string | null
  ask: string | null
  high24h: string | null
  low24h: string | null
  volume24h: string | null
  changePercent24h: string | null
  quote: AssetSymbol
  sourceTimestamp: number
  fetchedAt: number
}

/**
 * Volatility state derived from candles. `atr`/`stdev` are decimal strings in
 * price units; `annualizedPct` is a decimal string percent. `regime` is a
 * coarse label. Everything is computed deterministically from the candle series
 * so it is fully unit-testable (invariant: deterministic calculs testables).
 */
export interface VolatilityState {
  interval: CandleInterval
  /** Sample size the estimate is built from. */
  window: number
  /** Average True Range over `window`, decimal string, price units. */
  atr: string
  /** Stdev of log-returns over `window`, decimal string (unitless ratio). */
  stdevReturns: string
  /** Annualized volatility percent, decimal string (e.g. "62.4"). */
  annualizedPct: string
  regime: 'low' | 'normal' | 'high'
}

/** Multi-timeframe market structure read from candles. */
export interface MarketStructure {
  interval: CandleInterval
  /** 'up' | 'down' | 'range' — coarse trend classification. */
  trend: 'up' | 'down' | 'range'
  /** Key support levels, decimal strings, nearest first. */
  supports: string[]
  /** Key resistance levels, decimal strings, nearest first. */
  resistances: string[]
  /** Most recent swing high / low, decimal strings. */
  lastSwingHigh: string | null
  lastSwingLow: string | null
}

/** Liquidity / execution-condition snapshot. */
export interface LiquiditySnapshot {
  bestBid: string | null
  bestAsk: string | null
  /** Best bid/ask spread as a decimal string, price units. */
  spread: string | null
  /** Spread in basis points relative to mid. */
  spreadBps: number | null
  /** Top-of-book depth on each side, decimal strings (base-asset qty). */
  bidDepth: string | null
  askDepth: string | null
  /** (bid depth - ask depth) / total depth, in [-1,1]. */
  imbalance: number | null
  bookSize: number
  sourceTimestamp: number | null
  fetchedAt: number | null
  ageMs: number | null
  /** Coarse liquidity label derived from spread + depth. */
  quality: 'deep' | 'normal' | 'thin' | 'illiquid'
}

/** Funding / open-interest, when a perp source exists (often UNAVAILABLE). */
export interface FundingOpenInterest {
  /** Current funding rate as a decimal string (e.g. "0.0001" = 1bp). */
  fundingRate: string | null
  /** Open interest in base-asset units, decimal string. */
  openInterest: string | null
  /** Next funding time, epoch ms, if known. */
  nextFundingTime: number | null
}

/**
 * Account risk snapshot — the caller's own exposure, when TradeAgent exposes it
 * to a read scope. NEVER a private key, NEVER an order-capable field (invariant
 * #2/#3). Absent account data → the whole block is null + UNAVAILABLE.
 */
export interface AccountRiskSnapshot {
  /** Reference capital, decimal string, quote currency. Provenance-tagged. */
  referenceCapital: string | null
  /** Total current exposure across positions, decimal string. */
  totalExposure: string | null
  /** Number of open positions. */
  openPositions: number | null
  quote: AssetSymbol
}

/**
 * A per-block provenance record: each populated block of the snapshot points to
 * the provenance that produced it, so a consumer can see EXACTLY which parts
 * are LIVE/SNAPSHOT/UNAVAILABLE. `block` is the snapshot field name.
 */
export interface SnapshotSource {
  block: string
  provenance: Provenance
}

/**
 * The normalized snapshot. Any block may be `null` (UNAVAILABLE) — the matching
 * `sources[]` entry then carries `truth: 'UNAVAILABLE'` and a reason. The
 * top-level `truth` is the WORST truth across populated blocks (a snapshot is
 * only as trustworthy as its least-fresh datum).
 */
export interface MarketSnapshot {
  pair: PairSymbol
  /** True when `pair` is in TradeAgent's executable universe. */
  executable: boolean
  /** Point-in-time this snapshot answers for (epoch ms). */
  asOf: number
  /** Worst truth status across all populated blocks. */
  truth: TruthStatus
  ticker: Ticker | null
  candles: Partial<Record<CandleInterval, Candle[]>>
  structure: Partial<Record<CandleInterval, MarketStructure>>
  volatility: VolatilityState | null
  liquidity: LiquiditySnapshot | null
  fundingOpenInterest: FundingOpenInterest | null
  accountRisk: AccountRiskSnapshot | null
  /** Per-block provenance, one entry per attempted block. */
  sources: SnapshotSource[]
  /** Overall data completeness in [0,1]: populated blocks / attempted blocks. */
  completeness: number
  symbol: PairSymbol
  provider: string
  source_timestamp: number | null
  fetched_at: number
  age_ms: number | null
  last_price: string | null
  bid: string | null
  ask: string | null
  spread_bps: number | null
  volume_24h: string | null
  high_24h: string | null
  low_24h: string | null
  candles_summary: Array<{
    timeframe: CandleInterval
    count: number
    open: string | null
    high: string | null
    low: string | null
    close: string | null
    volume: string | null
    change_percent: string | null
  }>
  freshness_status: 'live' | 'stale' | 'unavailable'
  unavailable_fields: string[]
}

/** Compute the worst (least trustworthy) truth across provenances. */
export function worstTruth(sources: SnapshotSource[]): TruthStatus {
  const order: TruthStatus[] = [
    'LIVE',
    'SNAPSHOT',
    'HISTORICAL',
    'FALLBACK',
    'FIXTURE',
    'UNAVAILABLE',
  ]
  let worst: TruthStatus = 'LIVE'
  let worstRank = -1
  for (const s of sources) {
    const rank = order.indexOf(s.provenance.truth)
    if (rank > worstRank) {
      worstRank = rank
      worst = s.provenance.truth
    }
  }
  return worst
}
