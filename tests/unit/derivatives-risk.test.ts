import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AccountRiskSnapshot } from '@/lib/agent-mission-control/market/account-risk'
import { clearBinanceMarketCache } from '@/lib/agent-mission-control/market/binance-provider'
import { readLiveDerivativesSnapshot } from '@/lib/agent-mission-control/market/derivatives'
import { calculateRisk } from '@/lib/agent-mission-control/market/risk-engine'

const now = Date.now()
const originalFetch = global.fetch

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ date: new Date(now).toUTCString() }),
    json: async () => body,
  } as Response
}

describe('derivatives intelligence and risk scoring', () => {
  afterEach(() => {
    global.fetch = originalFetch
    clearBinanceMarketCache()
    vi.restoreAllMocks()
  })

  it('assembles funding, open interest, basis and deterministic regime', async () => {
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('premiumIndex')) {
        return response({
          markPrice: '51000',
          indexPrice: '50990',
          lastFundingRate: '0.0004',
          nextFundingTime: now + 3_600_000,
          time: now,
        })
      }
      if (url.includes('openInterestHist')) {
        return response([
          { sumOpenInterest: '1000', timestamp: now - 300_000 },
          { sumOpenInterest: '1030', timestamp: now },
        ])
      }
      if (url.includes('globalLongShort')) {
        return response([{ longShortRatio: '1.30', timestamp: now }])
      }
      if (url.includes('/openInterest?')) {
        return response({ openInterest: '1030', time: now })
      }
      if (url.includes('/fapi/v1/ticker/24hr')) {
        return response({ quoteVolume: '900000000', closeTime: now })
      }
      return response({
        lastPrice: '50000',
        bidPrice: '49999',
        askPrice: '50001',
        closeTime: now,
      })
    }) as typeof fetch

    const snapshot = await readLiveDerivativesSnapshot(now)

    expect(snapshot).toMatchObject({
      funding_rate: '0.0004',
      annualized_funding_rate: '43.8000',
      open_interest_usd: '52530000.00',
      open_interest_change: '3.0000',
      basis_bps: '200.0000',
      derivatives_regime: 'crowded_long',
      freshness_status: 'live',
    })
  })

  it('scores the same account and withdrawal deterministically', () => {
    const account: AccountRiskSnapshot = {
      account_id: 'demo-account',
      wallet_address: null,
      total_equity_usd: '10000',
      available_balance_usd: '3000',
      collateral_usd: '8000',
      borrowed_usd: '6000',
      net_exposure_usd: '15000',
      gross_exposure_usd: '18000',
      leverage: '1.8',
      ltv: '0.75',
      liquidation_buffer_pct: '18',
      unrealized_pnl_usd: '-500',
      realized_pnl_usd: null,
      position_count: 3,
      largest_position_pct: '60',
      concentration_score: '60',
      stablecoin_ratio: '0.3',
      btc_exposure_pct: '70',
      withdrawal_capacity_usd: '3000',
      pending_withdrawals_usd: '0',
      risk_flags: [],
      source_timestamp: now,
      fetched_at: now,
      freshness_status: 'live',
      unavailable_fields: [],
      source: 'tradeagent-account-snapshot',
    }
    const input = {
      account,
      spotPrice: '50000',
      volatility: {
        interval: '1h' as const,
        window: 20,
        atr: '1000',
        stdevReturns: '0.02',
        annualizedPct: '90',
        regime: 'high' as const,
      },
      liquidity: {
        bestBid: '49999',
        bestAsk: '50001',
        spread: '2',
        spreadBps: 4,
        bidDepth: '10',
        askDepth: '8',
        imbalance: 0.1,
        bookSize: 20,
        sourceTimestamp: now,
        fetchedAt: now,
        ageMs: 0,
        quality: 'normal' as const,
      },
      derivatives: {
        symbol: 'BTCUSDT' as const,
        provider: 'binance-futures' as const,
        source_timestamp: now,
        fetched_at: now,
        age_ms: 0,
        mark_price: '50010',
        index_price: '50000',
        funding_rate: '0.0004',
        annualized_funding_rate: '43.8',
        next_funding_at: now + 1,
        open_interest: '1000',
        open_interest_usd: '50000000',
        open_interest_change: '3',
        futures_volume_24h: '900000000',
        long_short_ratio: '1.3',
        basis_bps: '2',
        derivatives_regime: 'crowded_long' as const,
        freshness_status: 'live' as const,
        unavailable_fields: [],
      },
      requestedWithdrawalUsd: 2000,
    }

    expect(calculateRisk(input)).toEqual(calculateRisk(input))
    expect(calculateRisk(input)).toMatchObject({
      risk_level: 'high',
      lock_recommendation: 'reduce_exposure',
      withdrawal_recommendation: 'reduce_amount',
    })
    expect(calculateRisk({
      ...input,
      account: {
        ...account,
        ltv: null,
        liquidation_buffer_pct: null,
      },
    }).liquidation_risk).toBeNull()
  })
})
