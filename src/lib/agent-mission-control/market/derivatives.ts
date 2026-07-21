import 'server-only'

import {
  BINANCE_FUTURES_BASE_URL,
  BINANCE_FUTURES_HOST,
  BinanceMarketProvider,
  cachedBinanceJson,
  type BinanceFetchOutcome,
} from './binance-provider'

const FUTURES_TARGET = {
  baseUrl: BINANCE_FUTURES_BASE_URL,
  host: BINANCE_FUTURES_HOST,
}

export type DerivativesRegime =
  | 'neutral'
  | 'leveraged_long'
  | 'leveraged_short'
  | 'crowded_long'
  | 'crowded_short'
  | 'deleveraging'
  | 'unavailable'

export interface DerivativesSnapshot {
  symbol: 'BTCUSDT'
  provider: 'binance-futures'
  source_timestamp: number | null
  fetched_at: number
  age_ms: number | null
  mark_price: string | null
  index_price: string | null
  funding_rate: string | null
  annualized_funding_rate: string | null
  next_funding_at: number | null
  open_interest: string | null
  open_interest_usd: string | null
  open_interest_change: string | null
  futures_volume_24h: string | null
  long_short_ratio: string | null
  basis_bps: string | null
  derivatives_regime: DerivativesRegime
  freshness_status: 'live' | 'stale' | 'unavailable'
  unavailable_fields: string[]
}

function numberOf(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function bodyOf(result: BinanceFetchOutcome): Record<string, unknown> | null {
  return result.ok && result.body && typeof result.body === 'object' && !Array.isArray(result.body)
    ? result.body as Record<string, unknown>
    : null
}

function regimeOf(input: {
  fundingPct: number | null
  openInterestChangePct: number | null
  longShortRatio: number | null
}): DerivativesRegime {
  const { fundingPct, openInterestChangePct, longShortRatio } = input
  if (fundingPct === null || openInterestChangePct === null) return 'unavailable'
  if (openInterestChangePct <= -3) return 'deleveraging'
  if (fundingPct >= 0.03 && openInterestChangePct >= 2 && (longShortRatio ?? 1) >= 1.2) {
    return 'crowded_long'
  }
  if (fundingPct <= -0.03 && openInterestChangePct >= 2 && (longShortRatio ?? 1) <= 0.8) {
    return 'crowded_short'
  }
  if (fundingPct >= 0.01 && openInterestChangePct > 0) return 'leveraged_long'
  if (fundingPct <= -0.01 && openInterestChangePct > 0) return 'leveraged_short'
  return 'neutral'
}

export async function readLiveDerivativesSnapshot(
  asOf = Date.now(),
): Promise<DerivativesSnapshot> {
  const [premiumResult, openInterestResult, historyResult, tickerResult, ratioResult, spotResult] =
    await Promise.all([
      cachedBinanceJson('/fapi/v1/premiumIndex?symbol=BTCUSDT', 10_000, FUTURES_TARGET),
      cachedBinanceJson('/fapi/v1/openInterest?symbol=BTCUSDT', 15_000, FUTURES_TARGET),
      cachedBinanceJson(
        '/futures/data/openInterestHist?symbol=BTCUSDT&period=5m&limit=2',
        15_000,
        FUTURES_TARGET,
      ),
      cachedBinanceJson('/fapi/v1/ticker/24hr?symbol=BTCUSDT', 10_000, FUTURES_TARGET),
      cachedBinanceJson(
        '/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1',
        30_000,
        FUTURES_TARGET,
      ),
      new BinanceMarketProvider().getTicker('BTCUSDT', { asOf, maxAgeMs: 15_000 }),
    ])

  const premium = bodyOf(premiumResult)
  const openInterest = bodyOf(openInterestResult)
  const ticker = bodyOf(tickerResult)
  const history =
    historyResult.ok && Array.isArray(historyResult.body)
      ? historyResult.body as Array<Record<string, unknown>>
      : []
  const ratios =
    ratioResult.ok && Array.isArray(ratioResult.body)
      ? ratioResult.body as Array<Record<string, unknown>>
      : []

  const markPrice = stringOf(premium?.markPrice)
  const indexPrice = stringOf(premium?.indexPrice)
  const fundingRate = stringOf(premium?.lastFundingRate)
  const openInterestValue = stringOf(openInterest?.openInterest)
  const funding = numberOf(fundingRate)
  const mark = numberOf(markPrice)
  const spot = numberOf(spotResult.value?.last)
  const oi = numberOf(openInterestValue)
  const previousOi = numberOf(history.at(-2)?.sumOpenInterest)
  const currentOi = numberOf(history.at(-1)?.sumOpenInterest)
  const oiChange =
    previousOi !== null && currentOi !== null && previousOi !== 0
      ? ((currentOi - previousOi) / previousOi) * 100
      : null
  const longShortRatio = numberOf(ratios[0]?.longShortRatio)
  const basis = mark !== null && spot !== null && spot !== 0
    ? ((mark - spot) / spot) * 10_000
    : null
  const fundingPct = funding === null ? null : funding * 100
  const timestamps = [
    premiumResult.ok ? numberOf(premium?.time) ?? premiumResult.sourceTimestamp : null,
    openInterestResult.ok ? numberOf(openInterest?.time) ?? openInterestResult.sourceTimestamp : null,
    tickerResult.ok ? numberOf(ticker?.closeTime) ?? tickerResult.sourceTimestamp : null,
    ratioResult.ok ? numberOf(ratios[0]?.timestamp) ?? ratioResult.sourceTimestamp : null,
  ].filter((value): value is number => value !== null)
  const sourceTimestamp = timestamps.length ? Math.max(...timestamps) : null
  const fetchedAt = Date.now()
  const ageMs = sourceTimestamp === null ? null : Math.max(0, fetchedAt - sourceTimestamp)

  const snapshot: DerivativesSnapshot = {
    symbol: 'BTCUSDT',
    provider: 'binance-futures',
    source_timestamp: sourceTimestamp,
    fetched_at: fetchedAt,
    age_ms: ageMs,
    mark_price: markPrice,
    index_price: indexPrice,
    funding_rate: fundingRate,
    annualized_funding_rate: funding === null ? null : (funding * 3 * 365 * 100).toFixed(4),
    next_funding_at: numberOf(premium?.nextFundingTime),
    open_interest: openInterestValue,
    open_interest_usd: oi === null || mark === null ? null : (oi * mark).toFixed(2),
    open_interest_change: oiChange === null ? null : oiChange.toFixed(4),
    futures_volume_24h: stringOf(ticker?.quoteVolume),
    long_short_ratio: longShortRatio === null ? null : longShortRatio.toFixed(4),
    basis_bps: basis === null ? null : basis.toFixed(4),
    derivatives_regime: regimeOf({
      fundingPct,
      openInterestChangePct: oiChange,
      longShortRatio,
    }),
    freshness_status:
      sourceTimestamp === null ? 'unavailable' : ageMs !== null && ageMs <= 15_000 ? 'live' : 'stale',
    unavailable_fields: [],
  }

  const fields = [
    'mark_price',
    'index_price',
    'funding_rate',
    'annualized_funding_rate',
    'next_funding_at',
    'open_interest',
    'open_interest_usd',
    'open_interest_change',
    'futures_volume_24h',
    'long_short_ratio',
    'basis_bps',
  ] as const
  snapshot.unavailable_fields = fields.filter((field) => snapshot[field] === null)
  return snapshot
}
