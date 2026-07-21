import { describe, it, expect } from 'vitest'
import {
  readMarketSnapshot,
  readVolatilityState,
  readMarketStructure,
  readAccountRiskSnapshot,
  readLiquiditySnapshot,
  readFundingOpenInterest,
  readMacroContext,
  resolveProvider,
  TRADING_TOOL_HANDLERS,
} from '@/lib/agent-mission-control/market/tools'
import type { MarketSnapshot } from '@/lib/agent-mission-control/market/snapshot'
import { BinanceMarketProvider } from '@/lib/agent-mission-control/market/binance-provider'

describe('trading tools — fixture-backed, read-only, truth-aware', () => {
  it('read_market_snapshot on a trend-up fixture is SNAPSHOT-grade FIXTURE, never LIVE', async () => {
    const r = await readMarketSnapshot(
      JSON.stringify({ pair: 'ETHUSDT', intervals: ['1h'], fixtureScenario: 'trend-up' }),
    )
    expect(r.ok).toBe(true)
    const snap = r.data as MarketSnapshot
    expect(snap.pair).toBe('ETHUSDT')
    expect(snap.executable).toBe(true)
    expect(snap.truth).toBe('FIXTURE')
    // structure + volatility present
    expect(snap.structure['1h']?.trend).toBe('up')
    expect(snap.volatility).not.toBeNull()
    // capabilities the fixture lacks are UNAVAILABLE, never fabricated
    expect(snap.liquidity).toBeNull()
    expect(snap.fundingOpenInterest).toBeNull()
    const liqSrc = snap.sources.find((s) => s.block === 'liquidity')
    expect(liqSrc?.provenance.truth).toBe('UNAVAILABLE')
  })

  it('BTC pair is flagged non-executable (context only)', async () => {
    const r = await readMarketSnapshot(
      JSON.stringify({ pair: 'BTCUSDT', intervals: ['1h'], fixtureScenario: 'trend-up' }),
    )
    const snap = r.data as MarketSnapshot
    expect(snap.executable).toBe(false)
  })

  it('defaults runtime reads to the public Binance provider', () => {
    expect(resolveProvider({})).toBeInstanceOf(BinanceMarketProvider)
  })

  it('bad args are rejected with an error result, never a throw', async () => {
    const r = await readVolatilityState(JSON.stringify({ pair: 'DOGEUSDT' }))
    expect(r.ok).toBe(false)
    expect(r.summary).toMatch(/failed/i)
  })

  it('volatility on an incomplete fixture is UNAVAILABLE', async () => {
    const r = await readVolatilityState(
      JSON.stringify({ pair: 'ETHUSDT', interval: '1h', fixtureScenario: 'incomplete' }),
    )
    expect(r.ok).toBe(false)
    expect(r.summary).toMatch(/UNAVAILABLE/)
  })

  it('structure reflects the fixture regime', async () => {
    const r = await readMarketStructure(
      JSON.stringify({ pair: 'ETHUSDT', interval: '1h', fixtureScenario: 'trend-down' }),
    )
    expect(r.ok).toBe(true)
    expect(
      (r.data as { byTimeframe: { '1h': { structure: { trend: string } } } }).byTimeframe[
        '1h'
      ].structure.trend
    ).toBe('down')
  })

  it('account risk requires an explicit account and never selects one implicitly', async () => {
    const r = await readAccountRiskSnapshot('{}')
    expect(r.ok).toBe(false)
    expect((r.data as { accountRisk: null }).accountRisk).toBeNull()
    expect((r.data as { account_required: boolean }).account_required).toBe(true)
  })

  it('liquidity + funding are UNAVAILABLE on a candle-only fixture', async () => {
    const liq = await readLiquiditySnapshot(
      JSON.stringify({ pair: 'ETHUSDT', fixtureScenario: 'range' }),
    )
    const fo = await readFundingOpenInterest(
      JSON.stringify({ pair: 'ETHUSDT', fixtureScenario: 'range' }),
    )
    expect(liq.ok).toBe(false)
    expect(fo.ok).toBe(false)
  })

  it('macro context marks BTC legs as context-only', async () => {
    const r = await readMacroContext(JSON.stringify({ fixtureScenario: 'trend-up' }))
    expect((r.data as { note: string }).note).toMatch(/context only/i)
  })

  it('registry exposes exactly the 9 mission tools', () => {
    expect(Object.keys(TRADING_TOOL_HANDLERS).sort()).toEqual(
      [
        'read_account_risk_snapshot',
        'read_derivatives_snapshot',
        'read_funding_open_interest',
        'read_liquidity_snapshot',
        'read_macro_context',
        'read_market_snapshot',
        'read_market_structure',
        'read_multi_timeframe_candles',
        'read_volatility_state',
      ].sort(),
    )
  })
})
