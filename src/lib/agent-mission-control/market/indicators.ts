/**
 * AIG-TRADE-001 — deterministic indicator math.
 *
 * Pure functions over a Candle[] series. No I/O, no randomness, no clock — the
 * same input always yields the same output, so every value is unit-testable
 * (prompt Lot 1: "calculs déterministes testables"; Lot 5 benchmark dimension
 * "exactitude des calculs déterministes").
 *
 * Prices arrive as decimal strings (lossless transport). Indicator math needs
 * arithmetic, so we parse to Number ONLY here, INSIDE the analytics layer —
 * never on a ledger/money path (invariant: `Number(price)` forbidden where a
 * financial *decision* is made; an ATR is an analytical estimate, not money).
 * Results are re-serialized to decimal strings before leaving this module.
 */

import type {
  Candle,
  MarketStructure,
  VolatilityState,
} from './snapshot'

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000

const INTERVAL_MS: Record<Candle['interval'], number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
}

/** Parse a decimal-string price to a finite number, or null. Analytics-only. */
function num(s: string): number | null {
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Fixed-precision decimal string for an indicator output. */
function fixed(n: number, dp = 4): string {
  if (!Number.isFinite(n)) return '0'
  return n.toFixed(dp)
}

/**
 * Average True Range over the last `window` candles. Returns null when fewer
 * than `window + 1` valid candles are present (never fabricates an estimate).
 */
export function computeATR(candles: Candle[], window = 14): number | null {
  if (candles.length < window + 1) return null
  const trs: number[] = []
  for (let i = candles.length - window; i < candles.length; i++) {
    const h = num(candles[i].high)
    const l = num(candles[i].low)
    const prevClose = num(candles[i - 1].close)
    if (h === null || l === null || prevClose === null) return null
    const tr = Math.max(
      h - l,
      Math.abs(h - prevClose),
      Math.abs(l - prevClose),
    )
    trs.push(tr)
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length
}

/** Population stdev of log-returns over the last `window` candles, or null. */
export function computeStdevReturns(
  candles: Candle[],
  window = 20,
): number | null {
  if (candles.length < window + 1) return null
  const returns: number[] = []
  for (let i = candles.length - window; i < candles.length; i++) {
    const c = num(candles[i].close)
    const p = num(candles[i - 1].close)
    if (c === null || p === null || p <= 0 || c <= 0) return null
    returns.push(Math.log(c / p))
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance =
    returns.reduce((a, r) => a + (r - mean) * (r - mean), 0) / returns.length
  return Math.sqrt(variance)
}

/**
 * Full volatility state: ATR + stdev + annualized percent + coarse regime.
 * Returns null when the series is too short for either estimate.
 */
export function computeVolatilityState(
  candles: Candle[],
  opts: { atrWindow?: number; stdevWindow?: number } = {},
): VolatilityState | null {
  if (candles.length === 0) return null
  const interval = candles[candles.length - 1].interval
  const atrWindow = opts.atrWindow ?? 14
  const stdevWindow = opts.stdevWindow ?? 20
  const atr = computeATR(candles, atrWindow)
  const stdev = computeStdevReturns(candles, stdevWindow)
  if (atr === null || stdev === null) return null

  // Annualize stdev of per-candle log returns by sqrt of candles-per-year.
  const candlesPerYear = MS_PER_YEAR / INTERVAL_MS[interval]
  const annualized = stdev * Math.sqrt(candlesPerYear) * 100

  let regime: VolatilityState['regime']
  if (annualized < 30) regime = 'low'
  else if (annualized < 80) regime = 'normal'
  else regime = 'high'

  return {
    interval,
    window: Math.min(candles.length, Math.max(atrWindow, stdevWindow)),
    atr: fixed(atr, 2),
    stdevReturns: fixed(stdev, 6),
    annualizedPct: fixed(annualized, 1),
    regime,
  }
}

/**
 * Coarse trend + support/resistance from swing pivots. Deterministic:
 *   - trend from the slope of close over the series vs its own ATR band.
 *   - supports/resistances from local minima/maxima (fractal pivots).
 * Returns null on an empty series.
 */
export function computeMarketStructure(
  candles: Candle[],
  opts: { pivotLookback?: number; maxLevels?: number } = {},
): MarketStructure | null {
  if (candles.length < 5) return null
  const interval = candles[candles.length - 1].interval
  const lookback = opts.pivotLookback ?? 2
  const maxLevels = opts.maxLevels ?? 3

  const closes = candles.map((c) => num(c.close))
  const highs = candles.map((c) => num(c.high))
  const lows = candles.map((c) => num(c.low))
  if (closes.some((c) => c === null)) return null

  const first = closes[0] as number
  const last = closes[closes.length - 1] as number
  const atr = computeATR(candles, Math.min(14, candles.length - 1)) ?? 0
  const drift = last - first
  let trend: MarketStructure['trend']
  // A move smaller than 1 ATR over the window is treated as range-bound.
  if (Math.abs(drift) < atr) trend = 'range'
  else trend = drift > 0 ? 'up' : 'down'

  const resistances: number[] = []
  const supports: number[] = []
  for (let i = lookback; i < candles.length - lookback; i++) {
    const h = highs[i]
    const l = lows[i]
    if (h === null || l === null) continue
    let isHigh = true
    let isLow = true
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue
      const hj = highs[j]
      const lj = lows[j]
      if (hj === null || lj === null) continue
      if (hj >= h) isHigh = false
      if (lj <= l) isLow = false
    }
    if (isHigh) resistances.push(h)
    if (isLow) supports.push(l)
  }

  // Nearest to `last` first, deduped, capped.
  const nearestFirst = (arr: number[]) =>
    Array.from(new Set(arr))
      .sort((a, b) => Math.abs(a - last) - Math.abs(b - last))
      .slice(0, maxLevels)
      .map((v) => fixed(v, 2))

  const swingHigh = resistances.length
    ? Math.max(...resistances)
    : Math.max(...(highs.filter((h) => h !== null) as number[]))
  const swingLow = supports.length
    ? Math.min(...supports)
    : Math.min(...(lows.filter((l) => l !== null) as number[]))

  return {
    interval,
    trend,
    supports: nearestFirst(supports),
    resistances: nearestFirst(resistances),
    lastSwingHigh: fixed(swingHigh, 2),
    lastSwingLow: fixed(swingLow, 2),
  }
}
