/**
 * AIG-TRADE-001 — fixture-backed market provider (lab-only).
 *
 * Serves the frozen SCENARIOS as candles/tickers, always tagged
 * truth: 'FIXTURE' (or 'HISTORICAL' for a frozen real observation). It answers
 * for the scenario's OWN frozen asOf, so evaluation against it has NO temporal
 * leak (invariant #9). It never claims LIVE. Capabilities it lacks
 * (order book, funding) fall through to BaseMarketProvider → UNAVAILABLE.
 */

import type {
  Candle,
  CandleInterval,
  PairSymbol,
  Ticker,
} from '../snapshot'
import type { MarketSourceType } from '../truth'
import { makeProvenance } from '../truth'
import {
  BaseMarketProvider,
  type ProviderContext,
  type ProviderResult,
} from '../provider'
import { getScenario, type ScenarioId } from './scenarios'

export class FixtureMarketProvider extends BaseMarketProvider {
  readonly id: string
  readonly sourceType: MarketSourceType = 'fixture'
  private readonly scenarioId: ScenarioId

  constructor(scenarioId: ScenarioId) {
    super()
    this.scenarioId = scenarioId
    this.id = `fixture:${scenarioId}`
  }

  async getCandles(
    _pair: PairSymbol,
    interval: CandleInterval,
    limit: number,
    ctx: ProviderContext,
  ): Promise<ProviderResult<Candle[]>> {
    const scenario = getScenario(this.scenarioId)
    // Only serve the scenario's own interval; a mismatch is honestly empty.
    if (scenario.interval !== interval) {
      return {
        value: null,
        provenance: makeProvenance({
          source: this.id,
          sourceType: this.sourceType,
          truth: 'UNAVAILABLE',
          dataTimestamp: scenario.asOf,
          asOf: ctx.asOf,
          maxAgeMs: null,
          confidence: 0,
        }),
      }
    }
    const candles = scenario.candles.slice(-limit)
    return {
      value: candles,
      provenance: makeProvenance({
        source: this.id,
        sourceType: this.sourceType,
        truth: scenario.truth,
        dataTimestamp: scenario.asOf,
        // A fixture answers for its OWN frozen instant — pin asOf to it.
        asOf: scenario.asOf,
        maxAgeMs: null,
        confidence: 1,
      }),
    }
  }

  async getTicker(
    pair: PairSymbol,
    _ctx: ProviderContext,
  ): Promise<ProviderResult<Ticker>> {
    const scenario = getScenario(this.scenarioId)
    const last = scenario.candles[scenario.candles.length - 1]
    const first = scenario.candles[0]
    const highs = scenario.candles.map((c) => Number(c.high))
    const lows = scenario.candles.map((c) => Number(c.low))
    const changePct =
      Number(first.close) > 0
        ? ((Number(last.close) - Number(first.close)) / Number(first.close)) * 100
        : 0
    const ticker: Ticker = {
      last: last.close,
      bid: null,
      ask: null,
      high24h: Math.max(...highs).toFixed(2),
      low24h: Math.min(...lows).toFixed(2),
      volume24h: scenario.candles
        .reduce((a, c) => a + Number(c.volume), 0)
        .toFixed(4),
      changePercent24h: changePct.toFixed(2),
      quote: pair.endsWith('USDC') ? 'USDC' : 'USDT',
      sourceTimestamp: scenario.asOf,
      fetchedAt: scenario.asOf,
    }
    return {
      value: ticker,
      provenance: makeProvenance({
        source: this.id,
        sourceType: this.sourceType,
        truth: scenario.truth,
        dataTimestamp: scenario.asOf,
        asOf: scenario.asOf,
        maxAgeMs: null,
        confidence: 1,
      }),
    }
  }
}
