/**
 * AIG-TRADE-001 — labeled market fixtures (lab-only).
 *
 * Hand-authored, DETERMINISTIC candle scenarios. Every series is FROZEN at a
 * fixed base epoch so there is NO temporal leak (invariant #9): a HISTORICAL
 * fixture answers for its own frozen `asOf`, never "now". Each scenario carries
 * an explicit truth label — FIXTURE (synthetic) or HISTORICAL (a frozen real
 * observation would go here). These MUST NEVER surface on a normal product
 * screen (invariant #18); they live behind the test/lab boundary.
 *
 * The generator is a pure function of (base, step, shape) — no Date.now(), no
 * Math.random() — so the same scenario id always yields byte-identical candles.
 */

import type { Candle, CandleInterval } from '../snapshot'
import type { TruthStatus } from '../truth'

/** A frozen base instant (2026-01-01T00:00:00Z) all fixtures anchor to. */
export const FIXTURE_BASE_EPOCH = 1_767_225_600_000

const INTERVAL_MS: Record<CandleInterval, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
}

export type ScenarioId =
  | 'trend-up'
  | 'trend-down'
  | 'range'
  | 'high-volatility'
  | 'thin-liquidity'
  | 'false-breakout'
  | 'reversal'
  | 'incomplete'

export interface Scenario {
  id: ScenarioId
  truth: TruthStatus
  description: string
  interval: CandleInterval
  candles: Candle[]
  /** asOf the scenario answers for — the close time of its last candle. */
  asOf: number
}

/** Deterministic OHLC builder from a close path; high/low bracket the body. */
function seriesFromCloses(
  closes: number[],
  interval: CandleInterval,
  wickPct: number,
  baseVolume: number,
): Candle[] {
  const step = INTERVAL_MS[interval]
  const out: Candle[] = []
  for (let i = 0; i < closes.length; i++) {
    const openTime = FIXTURE_BASE_EPOCH + i * step
    const closeTime = openTime + step - 1
    const close = closes[i]
    const open = i === 0 ? close : closes[i - 1]
    const hi = Math.max(open, close) * (1 + wickPct)
    const lo = Math.min(open, close) * (1 - wickPct)
    // Deterministic volume ramp: base + a fixed per-index component.
    const volume = baseVolume + (i % 5) * (baseVolume * 0.1)
    out.push({
      openTime,
      closeTime,
      open: open.toFixed(2),
      high: hi.toFixed(2),
      low: lo.toFixed(2),
      close: close.toFixed(2),
      volume: volume.toFixed(4),
      interval,
    })
  }
  return out
}

function ramp(from: number, to: number, n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(from + ((to - from) * i) / (n - 1))
  return out
}

function oscillate(mid: number, amp: number, n: number, periods: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    // Deterministic triangle wave (no Math.random / no trig-drift concerns).
    const phase = ((i / n) * periods) % 1
    const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2 // 0..1..0
    out.push(mid + (tri - 0.5) * 2 * amp)
  }
  return out
}

function build(
  id: ScenarioId,
  truth: TruthStatus,
  description: string,
  interval: CandleInterval,
  closes: number[],
  wickPct: number,
  baseVolume: number,
): Scenario {
  const candles = seriesFromCloses(closes, interval, wickPct, baseVolume)
  return {
    id,
    truth,
    description,
    interval,
    candles,
    asOf: candles.at(-1)!.closeTime,
  }
}

export const SCENARIOS: Readonly<Record<ScenarioId, Scenario>> = {
  'trend-up': build(
    'trend-up',
    'FIXTURE',
    'Clean uptrend: ETH 3000 → 3600 over 60 candles, small wicks.',
    '1h',
    ramp(3000, 3600, 60),
    0.004,
    1200,
  ),
  'trend-down': build(
    'trend-down',
    'FIXTURE',
    'Clean downtrend: ETH 3600 → 3000 over 60 candles.',
    '1h',
    ramp(3600, 3000, 60),
    0.004,
    1200,
  ),
  range: build(
    'range',
    'FIXTURE',
    'Range-bound: ETH oscillating 3200±60 over 60 candles.',
    '1h',
    oscillate(3200, 60, 60, 4),
    0.003,
    900,
  ),
  'high-volatility': build(
    'high-volatility',
    'FIXTURE',
    'High volatility: ETH oscillating 3200±260 with large wicks.',
    '1h',
    oscillate(3200, 260, 60, 6),
    0.02,
    2400,
  ),
  'thin-liquidity': build(
    'thin-liquidity',
    'FIXTURE',
    'Thin liquidity proxy: low, choppy volume, wide wicks, small body.',
    '1h',
    oscillate(3200, 30, 40, 3),
    0.015,
    80,
  ),
  'false-breakout': build(
    'false-breakout',
    'FIXTURE',
    'False breakout: range then a spike above resistance that fails back in.',
    '1h',
    [...oscillate(3200, 50, 40, 3), 3320, 3360, 3290, 3210, 3200, 3195],
    0.006,
    1000,
  ),
  reversal: build(
    'reversal',
    'FIXTURE',
    'Trend reversal: up 3000→3400 then down 3400→3050.',
    '1h',
    [...ramp(3000, 3400, 30), ...ramp(3400, 3050, 30)],
    0.005,
    1300,
  ),
  incomplete: {
    id: 'incomplete',
    truth: 'FIXTURE',
    description: 'Deliberately too short for ATR/stdev — forces UNAVAILABLE.',
    interval: '1h',
    candles: seriesFromCloses([3200, 3210, 3190], '1h', 0.003, 500),
    asOf: FIXTURE_BASE_EPOCH + 2 * INTERVAL_MS['1h'] + INTERVAL_MS['1h'] - 1,
  },
}

export function getScenario(id: ScenarioId): Scenario {
  return SCENARIOS[id]
}
