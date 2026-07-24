import { describe, it, expect } from 'vitest'
import {
  assembleSnapshot,
  liquidityFromOrderBook,
} from '@/lib/agent-mission-control/market/assembler'
import type {
  MarketDataProvider,
  ProviderContext,
  ProviderResult,
} from '@/lib/agent-mission-control/market/provider'
import type { Candle, CandleInterval, PairSymbol, Ticker } from '@/lib/agent-mission-control/market/snapshot'
import { makeProvenance, unavailableProvenance } from '@/lib/agent-mission-control/market/truth'

const ASOF = 1_767_225_600_000

function ctx(overrides: Partial<ProviderContext> = {}): ProviderContext {
  return { asOf: ASOF, maxAgeMs: null, ...overrides }
}

function candle(overrides: Partial<Candle> = {}): Candle {
  return {
    openTime: ASOF - 60_000,
    closeTime: ASOF,
    open: '100.00',
    high: '105.00',
    low: '99.00',
    close: '102.00',
    volume: '10.5',
    interval: '1h',
    ...overrides,
  }
}

function ticker(overrides: Partial<Ticker> = {}): Ticker {
  return {
    last: '102.00',
    bid: '101.50',
    ask: '102.50',
    high24h: '110.00',
    low24h: '95.00',
    volume24h: '1000.0',
    changePercent24h: '1.5',
    quote: 'USDT',
    sourceTimestamp: ASOF,
    fetchedAt: ASOF,
    ...overrides,
  }
}

/** A fully-populated provider — every capability returns a LIVE datum. */
class FullProvider implements MarketDataProvider {
  readonly id = 'test:full'
  readonly sourceType = 'fixture' as const

  async getCandles(
    _pair: PairSymbol,
    interval: CandleInterval,
    _limit: number,
    c: ProviderContext,
  ): Promise<ProviderResult<Candle[]>> {
    // Enough candles for structure/volatility math (indicators need a window).
    const candles = Array.from({ length: 30 }, (_, i) =>
      candle({
        interval,
        openTime: ASOF - (30 - i) * 60_000,
        closeTime: ASOF - (29 - i) * 60_000,
        open: String(100 + i),
        high: String(101 + i),
        low: String(99 + i),
        close: String(100.5 + i),
        volume: '5',
      }),
    )
    return {
      value: candles,
      provenance: makeProvenance({
        source: 'test:full/candles',
        sourceType: 'fixture',
        truth: 'LIVE',
        dataTimestamp: c.asOf,
        asOf: c.asOf,
        maxAgeMs: c.maxAgeMs,
        confidence: 1,
      }),
    }
  }

  async getTicker(_pair: PairSymbol, c: ProviderContext): Promise<ProviderResult<Ticker>> {
    return {
      value: ticker(),
      provenance: makeProvenance({
        source: 'test:full/ticker',
        sourceType: 'fixture',
        truth: 'LIVE',
        dataTimestamp: c.asOf,
        asOf: c.asOf,
        maxAgeMs: c.maxAgeMs,
        confidence: 1,
      }),
    }
  }

  async getOrderBook(
    _pair: PairSymbol,
    _depth: number,
    c: ProviderContext,
  ): Promise<ProviderResult<{ bids: [string, string][]; asks: [string, string][] }>> {
    return {
      value: {
        bids: [
          ['101.50', '2.0'],
          ['101.40', '3.0'],
        ],
        asks: [
          ['101.60', '2.5'],
          ['101.70', '1.5'],
        ],
      },
      provenance: makeProvenance({
        source: 'test:full/orderbook',
        sourceType: 'fixture',
        truth: 'LIVE',
        dataTimestamp: c.asOf,
        asOf: c.asOf,
        maxAgeMs: c.maxAgeMs,
        confidence: 1,
      }),
    }
  }

  async getFundingOpenInterest(
    _pair: PairSymbol,
    c: ProviderContext,
  ): Promise<
    ProviderResult<{
      fundingRate: string | null
      openInterest: string | null
      nextFundingTime: number | null
    }>
  > {
    return {
      value: { fundingRate: '0.0001', openInterest: '5000', nextFundingTime: ASOF + 3_600_000 },
      provenance: makeProvenance({
        source: 'test:full/funding',
        sourceType: 'fixture',
        truth: 'LIVE',
        dataTimestamp: c.asOf,
        asOf: c.asOf,
        maxAgeMs: c.maxAgeMs,
        confidence: 1,
      }),
    }
  }
}

/** A provider where every capability is UNAVAILABLE — never fabricates. */
class EmptyProvider implements MarketDataProvider {
  readonly id = 'test:empty'
  readonly sourceType = 'fixture' as const

  private unavailable(source: string, c: ProviderContext, reason: string) {
    return unavailableProvenance({ source, sourceType: this.sourceType, asOf: c.asOf, reason })
  }

  async getCandles(
    _pair: PairSymbol,
    _interval: CandleInterval,
    _limit: number,
    c: ProviderContext,
  ): Promise<ProviderResult<Candle[]>> {
    return { value: null, provenance: this.unavailable('test:empty/candles', c, 'no candles') }
  }

  async getTicker(_pair: PairSymbol, c: ProviderContext): Promise<ProviderResult<Ticker>> {
    return { value: null, provenance: this.unavailable('test:empty/ticker', c, 'no ticker') }
  }

  async getOrderBook(
    _pair: PairSymbol,
    _depth: number,
    c: ProviderContext,
  ): Promise<ProviderResult<{ bids: [string, string][]; asks: [string, string][] }>> {
    return { value: null, provenance: this.unavailable('test:empty/orderbook', c, 'no order book') }
  }

  async getFundingOpenInterest(
    _pair: PairSymbol,
    c: ProviderContext,
  ): Promise<
    ProviderResult<{
      fundingRate: string | null
      openInterest: string | null
      nextFundingTime: number | null
    }>
  > {
    return { value: null, provenance: this.unavailable('test:empty/funding', c, 'no funding') }
  }
}

describe('assembleSnapshot', () => {
  it('produces a fully-populated snapshot with LIVE truth and complete provenance', async () => {
    const snap = await assembleSnapshot(new FullProvider(), {
      pair: 'ETHUSDT',
      intervals: ['1h'],
      candleLimit: 30,
      volatilityInterval: '1h',
      ctx: ctx(),
    })

    expect(snap.pair).toBe('ETHUSDT')
    expect(snap.executable).toBe(true)
    expect(snap.truth).toBe('LIVE')
    expect(snap.freshness_status).toBe('live')
    expect(snap.ticker).not.toBeNull()
    expect(snap.candles['1h']).toHaveLength(30)
    expect(snap.structure['1h']).toBeDefined()
    expect(snap.liquidity).not.toBeNull()
    expect(snap.fundingOpenInterest).not.toBeNull()
    // completeness = populated / attempted; every block populated here.
    expect(snap.completeness).toBe(1)
    expect(snap.unavailable_fields).toEqual([])
    // provenance recorded per attempted block: ticker, candles:1h, volatility,
    // liquidity, fundingOpenInterest.
    expect(snap.sources.map((s) => s.block)).toEqual(
      expect.arrayContaining(['ticker', 'candles:1h', 'volatility', 'liquidity', 'fundingOpenInterest']),
    )
    // last/bid/ask derived from ticker when present.
    expect(snap.last_price).toBe('102.00')
    expect(snap.bid).toBe('101.50')
    expect(snap.ask).toBe('102.50')
    expect(snap.source_timestamp).toBe(ASOF)
    // age_ms = fetched_at (real Date.now()) - source_timestamp (frozen ASOF);
    // never negative, clamped by the module itself.
    expect(snap.age_ms).not.toBeNull()
    expect(snap.age_ms as number).toBeGreaterThanOrEqual(0)
  })

  it('never fabricates: a fully-unavailable provider yields UNAVAILABLE truth, null blocks, zero completeness', async () => {
    const snap = await assembleSnapshot(new EmptyProvider(), {
      pair: 'ETHUSDT',
      intervals: ['1h'],
      candleLimit: 30,
      volatilityInterval: '1h',
      ctx: ctx(),
    })

    expect(snap.truth).toBe('UNAVAILABLE')
    expect(snap.freshness_status).toBe('unavailable')
    expect(snap.ticker).toBeNull()
    expect(snap.candles['1h']).toBeUndefined()
    expect(snap.volatility).toBeNull()
    expect(snap.liquidity).toBeNull()
    expect(snap.fundingOpenInterest).toBeNull()
    expect(snap.completeness).toBe(0)
    expect(snap.last_price).toBeNull()
    expect(snap.bid).toBeNull()
    expect(snap.ask).toBeNull()
    expect(snap.source_timestamp).toBeNull()
    expect(snap.age_ms).toBeNull()
    // Every attempted block surfaces as unavailable — ticker, candles:1h,
    // volatility (inherits candle provenance), liquidity, fundingOpenInterest.
    expect(snap.unavailable_fields).toEqual(
      expect.arrayContaining(['ticker', 'candles:1h', 'liquidity', 'fundingOpenInterest']),
    )
  })

  it('flags a non-executable pair (BTC) as context-only', async () => {
    const snap = await assembleSnapshot(new EmptyProvider(), {
      pair: 'BTCUSDT',
      intervals: [],
      candleLimit: 10,
      volatilityInterval: '1h',
      ctx: ctx(),
    })
    expect(snap.executable).toBe(false)
  })

  it('is deterministic given a fixed asOf and identical provider responses', async () => {
    const opts = {
      pair: 'ETHUSDT' as const,
      intervals: ['1h' as const],
      candleLimit: 30,
      volatilityInterval: '1h' as const,
      ctx: ctx(),
    }
    const a = await assembleSnapshot(new FullProvider(), opts)
    const b = await assembleSnapshot(new FullProvider(), opts)
    // fetched_at is Date.now()-derived, strip it before comparing.
    const { fetched_at: _a, age_ms: __a, ...restA } = a
    const { fetched_at: _b, age_ms: __b, ...restB } = b
    expect(restA).toEqual(restB)
  })
})

describe('liquidityFromOrderBook', () => {
  it('computes bid/ask/spread/depth/imbalance/quality deterministically from a known book', () => {
    const liq = liquidityFromOrderBook({
      bids: [
        ['100.00', '2.0'],
        ['99.90', '3.0'],
      ],
      asks: [
        ['100.10', '1.0'],
        ['100.20', '4.0'],
      ],
      sourceTimestamp: ASOF - 500,
      fetchedAt: ASOF,
    })

    expect(liq.bestBid).toBe('100.00')
    expect(liq.bestAsk).toBe('100.10')
    // mid = 100.05, spread = 0.10
    expect(liq.spread).toBe('0.10')
    // spreadBps = round(0.10 / 100.05 * 10000) = 10
    expect(liq.spreadBps).toBe(10)
    expect(liq.bidDepth).toBe('5.0000')
    expect(liq.askDepth).toBe('5.0000')
    // imbalance = (5 - 5) / 10 = 0
    expect(liq.imbalance).toBe(0)
    expect(liq.bookSize).toBe(4)
    expect(liq.sourceTimestamp).toBe(ASOF - 500)
    expect(liq.fetchedAt).toBe(ASOF)
    expect(liq.ageMs).toBe(500)
    // spreadBps 10 -> 'normal' (<=8 normal, <=30 thin) — verify actual boundary below.
  })

  it('classifies quality from spread/depth thresholds — deep, normal, thin, illiquid', () => {
    // deep: spreadBps <= 2 AND bidDepth+askDepth > 100
    const deep = liquidityFromOrderBook({
      bids: [['100.00', '60']],
      asks: [['100.02', '60']],
    })
    expect(deep.spreadBps).toBe(2)
    expect(deep.quality).toBe('deep')

    // normal: spreadBps <= 8, insufficient depth for 'deep'
    const normal = liquidityFromOrderBook({
      bids: [['100.00', '1']],
      asks: [['100.06', '1']],
    })
    expect(normal.quality).toBe('normal')

    // thin: spreadBps <= 30
    const thin = liquidityFromOrderBook({
      bids: [['100.00', '1']],
      asks: [['100.25', '1']],
    })
    expect(thin.quality).toBe('thin')

    // illiquid: spreadBps > 30
    const illiquid = liquidityFromOrderBook({
      bids: [['100.00', '1']],
      asks: [['105.00', '1']],
    })
    expect(illiquid.quality).toBe('illiquid')
  })

  it('imbalance skews positive when bid depth dominates, negative when ask depth dominates', () => {
    const bidHeavy = liquidityFromOrderBook({
      bids: [['100.00', '9']],
      asks: [['100.10', '1']],
    })
    expect(bidHeavy.imbalance).toBeCloseTo(0.8, 10)

    const askHeavy = liquidityFromOrderBook({
      bids: [['100.00', '1']],
      asks: [['100.10', '9']],
    })
    expect(askHeavy.imbalance).toBeCloseTo(-0.8, 10)
  })

  it('never fabricates on an empty order book: nulls, illiquid, zero book size, no thrown error', () => {
    const empty = liquidityFromOrderBook({ bids: [], asks: [] })
    expect(empty.bestBid).toBeNull()
    expect(empty.bestAsk).toBeNull()
    expect(empty.spread).toBeNull()
    expect(empty.spreadBps).toBeNull()
    expect(empty.bidDepth).toBeNull()
    expect(empty.askDepth).toBeNull()
    expect(empty.imbalance).toBeNull()
    expect(empty.bookSize).toBe(0)
    expect(empty.quality).toBe('illiquid')
    expect(empty.sourceTimestamp).toBeNull()
    expect(empty.fetchedAt).toBeNull()
    expect(empty.ageMs).toBeNull()
  })

  it('one-sided book (bids only) never fabricates the missing side', () => {
    const oneSided = liquidityFromOrderBook({
      bids: [['100.00', '5']],
      asks: [],
    })
    expect(oneSided.bestBid).toBe('100.00')
    expect(oneSided.bestAsk).toBeNull()
    // spread/spreadBps require both sides — never derived from one.
    expect(oneSided.spread).toBeNull()
    expect(oneSided.spreadBps).toBeNull()
    expect(oneSided.quality).toBe('illiquid')
    // bid depth still computed even though ask side is absent.
    expect(oneSided.bidDepth).toBe('5.0000')
    expect(oneSided.askDepth).toBeNull()
    expect(oneSided.imbalance).toBe(1)
  })

  it('preserves decimal-string prices exactly — no float coercion of bestBid/bestAsk', () => {
    const liq = liquidityFromOrderBook({
      bids: [['0.123456789012345', '1']],
      asks: [['0.123456789099999', '1']],
    })
    // bestBid/bestAsk are the raw source strings, not `Number(...).toString()`.
    expect(liq.bestBid).toBe('0.123456789012345')
    expect(liq.bestAsk).toBe('0.123456789099999')
  })

  it('only considers the top 10 levels per side for depth', () => {
    const bids: [string, string][] = Array.from({ length: 15 }, (_, i) => [String(100 - i), '1'])
    const asks: [string, string][] = Array.from({ length: 15 }, (_, i) => [String(101 + i), '1'])
    const liq = liquidityFromOrderBook({ bids, asks })
    expect(liq.bidDepth).toBe('10.0000')
    expect(liq.askDepth).toBe('10.0000')
    // bookSize counts ALL levels, not just the top 10 used for depth.
    expect(liq.bookSize).toBe(30)
  })
})
