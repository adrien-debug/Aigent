/**
 * AIG-TRADE-001 — snapshot assembler.
 *
 * Composes a MarketDataProvider's reads + deterministic indicator math into a
 * normalized MarketSnapshot. Every attempted block records a `SnapshotSource`
 * provenance entry (populated OR unavailable), the top-level `truth` is the
 * worst across populated blocks, and `completeness` is populated/attempted.
 *
 * NEVER fabricates a block: an unavailable provider result yields a null block
 * + an UNAVAILABLE provenance, so a consumer always sees exactly which parts
 * are trustworthy.
 */

import 'server-only'

import type { MarketDataProvider, ProviderContext } from './provider'
import {
  computeMarketStructure,
  computeVolatilityState,
} from './indicators'
import {
  isExecutablePair,
  worstTruth,
  type CandleInterval,
  type LiquiditySnapshot,
  type MarketSnapshot,
  type PairSymbol,
  type SnapshotSource,
} from './snapshot'

export interface AssembleOptions {
  pair: PairSymbol
  /** Intervals to fetch candles + structure for. */
  intervals: CandleInterval[]
  /** Candle limit per interval. */
  candleLimit: number
  /** Which interval drives the top-level volatility state. */
  volatilityInterval: CandleInterval
  ctx: ProviderContext
}

export async function assembleSnapshot(
  provider: MarketDataProvider,
  opts: AssembleOptions,
): Promise<MarketSnapshot> {
  const sources: SnapshotSource[] = []
  const snap: MarketSnapshot = {
    pair: opts.pair,
    executable: isExecutablePair(opts.pair),
    asOf: opts.ctx.asOf,
    truth: 'UNAVAILABLE',
    ticker: null,
    candles: {},
    structure: {},
    volatility: null,
    liquidity: null,
    fundingOpenInterest: null,
    accountRisk: null,
    sources,
    completeness: 0,
  }

  let attempted = 0
  let populated = 0

  // Ticker
  attempted++
  const tickerRes = await provider.getTicker(opts.pair, opts.ctx)
  sources.push({ block: 'ticker', provenance: tickerRes.provenance })
  if (tickerRes.value) {
    snap.ticker = tickerRes.value
    populated++
  }

  // Candles + structure per interval
  for (const interval of opts.intervals) {
    attempted++
    const res = await provider.getCandles(
      opts.pair,
      interval,
      opts.candleLimit,
      opts.ctx,
    )
    sources.push({ block: `candles:${interval}`, provenance: res.provenance })
    if (res.value && res.value.length > 0) {
      snap.candles[interval] = res.value
      populated++
      const structure = computeMarketStructure(res.value)
      if (structure) snap.structure[interval] = structure
    }
  }

  // Volatility from the designated interval's candles
  attempted++
  const volCandles = snap.candles[opts.volatilityInterval]
  if (volCandles && volCandles.length > 0) {
    const vol = computeVolatilityState(volCandles)
    if (vol) {
      snap.volatility = vol
      populated++
    }
  }
  // Volatility inherits the provenance of its source candles.
  {
    const src = sources.find(
      (s) => s.block === `candles:${opts.volatilityInterval}`,
    )
    if (src) sources.push({ block: 'volatility', provenance: src.provenance })
  }

  // Liquidity from order book (usually UNAVAILABLE on candle-only sources)
  attempted++
  const obRes = await provider.getOrderBook(opts.pair, 20, opts.ctx)
  sources.push({ block: 'liquidity', provenance: obRes.provenance })
  if (obRes.value) {
    snap.liquidity = liquidityFromOrderBook(obRes.value)
    populated++
  }

  // Funding / OI (perp-only; usually UNAVAILABLE)
  attempted++
  const foRes = await provider.getFundingOpenInterest(opts.pair, opts.ctx)
  sources.push({ block: 'fundingOpenInterest', provenance: foRes.provenance })
  if (foRes.value) {
    snap.fundingOpenInterest = foRes.value
    populated++
  }

  const populatedSources = sources.filter(
    (s) => s.provenance.truth !== 'UNAVAILABLE',
  )
  snap.truth = populatedSources.length ? worstTruth(populatedSources) : 'UNAVAILABLE'
  snap.completeness = attempted > 0 ? populated / attempted : 0
  return snap
}

function liquidityFromOrderBook(ob: {
  bids: [string, string][]
  asks: [string, string][]
}): LiquiditySnapshot {
  const bestBid = ob.bids[0] ? Number(ob.bids[0][0]) : null
  const bestAsk = ob.asks[0] ? Number(ob.asks[0][0]) : null
  const bidDepth = ob.bids
    .slice(0, 10)
    .reduce((a, [, q]) => a + Number(q), 0)
  const askDepth = ob.asks
    .slice(0, 10)
    .reduce((a, [, q]) => a + Number(q), 0)
  let spread: string | null = null
  let spreadBps: number | null = null
  let quality: LiquiditySnapshot['quality'] = 'illiquid'
  if (bestBid !== null && bestAsk !== null && bestBid > 0 && bestAsk > 0) {
    const mid = (bestBid + bestAsk) / 2
    const s = bestAsk - bestBid
    spread = s.toFixed(2)
    spreadBps = mid > 0 ? Math.round((s / mid) * 10_000) : null
    if (spreadBps !== null) {
      if (spreadBps <= 2 && bidDepth + askDepth > 100) quality = 'deep'
      else if (spreadBps <= 8) quality = 'normal'
      else if (spreadBps <= 30) quality = 'thin'
      else quality = 'illiquid'
    }
  }
  return {
    spread,
    spreadBps,
    bidDepth: bidDepth > 0 ? bidDepth.toFixed(4) : null,
    askDepth: askDepth > 0 ? askDepth.toFixed(4) : null,
    quality,
  }
}
