/**
 * AIG-TRADE-001 — trading tool handlers (server only, read-only).
 *
 * The market-data tools the six copilots call. Each handler:
 *   - validates args with Zod (strict types, bounds, enums) → error result on
 *     bad input, NEVER a throw (mirrors tool-handlers.ts SAFETY CONTRACT);
 *   - resolves a MarketDataProvider (HTTP → TradeAgent live, or fixture → lab);
 *   - returns a compact, JSON-serializable `{ ok, data, summary }`;
 *   - NEVER writes anywhere, NEVER touches an order/account-mutating path
 *     (invariants #1/#2/#3), NEVER fabricates a value (missing → UNAVAILABLE).
 *
 * Handlers are keyed by MANIFEST TOOL NAME in TRADING_TOOL_HANDLERS so they
 * plug into the same registry shape as the existing TOOL_HANDLERS.
 */

import 'server-only'

import { z } from 'zod'
import type { MarketDataProvider, ProviderContext } from './provider'
import { HttpMarketProvider } from './provider'
import { BinanceMarketProvider } from './binance-provider'
import { FixtureMarketProvider } from './fixtures/fixture-provider'
import type { ScenarioId } from './fixtures/scenarios'
import { assembleSnapshot, liquidityFromOrderBook } from './assembler'
import { readAccountRisk } from './account-risk'
import { readLiveDerivativesSnapshot } from './derivatives'
import { calculateRisk } from './risk-engine'
import {
  computeMarketStructure,
  computeVolatilityState,
} from './indicators'
import {
  CANDLE_INTERVALS,
  PAIR_SYMBOLS,
  isExecutablePair,
  type CandleInterval,
  type PairSymbol,
} from './snapshot'

export interface TradingToolResult {
  ok: boolean
  data: unknown
  summary: string
}

const pairSchema = z.enum(PAIR_SYMBOLS as unknown as [PairSymbol, ...PairSymbol[]])
const intervalSchema = z.enum(
  CANDLE_INTERVALS as unknown as [CandleInterval, ...CandleInterval[]],
)

/**
 * Resolve which provider to use. Fixture mode is explicit and lab-only: a
 * `fixtureScenario` arg (only accepted in a lab context) forces the fixture
 * provider; otherwise the HTTP provider reads TradeAgent's live routes. If no
 * live base URL is configured AND no fixture is requested, the tool returns
 * UNAVAILABLE rather than inventing data.
 */
export function resolveProvider(args: {
  fixtureScenario?: ScenarioId
  baseUrl?: string | null
}): MarketDataProvider | null {
  if (args.fixtureScenario) return new FixtureMarketProvider(args.fixtureScenario)
  if (args.baseUrl) return new HttpMarketProvider({ baseUrl: args.baseUrl })
  // EVAL-ONLY mode stays explicit. Runtime reads use Binance public spot
  // directly, without a key and without a silent secondary provider.
  const envFixture = process.env.AIG_MARKET_FIXTURE as ScenarioId | undefined
  if (envFixture) return new FixtureMarketProvider(envFixture)
  return new BinanceMarketProvider()
}

function ctxOf(asOf?: number, maxAgeMs?: number | null): ProviderContext {
  return {
    asOf: asOf ?? Date.now(),
    maxAgeMs: maxAgeMs === undefined ? 60_000 : maxAgeMs,
  }
}

function parse<T>(schema: z.ZodType<T>, argsJson: string): T | { __err: string } {
  let raw: unknown
  try {
    raw = argsJson ? JSON.parse(argsJson) : {}
  } catch {
    return { __err: 'invalid JSON args' }
  }
  const r = schema.safeParse(raw)
  if (!r.success) return { __err: r.error.issues.map((i) => i.message).join('; ') }
  return r.data
}

function err(tool: string, message: string): TradingToolResult {
  return { ok: false, data: { error: message }, summary: `${tool} failed: ${message}` }
}

// ---------------------------------------------------------------------------
// read_market_snapshot
// ---------------------------------------------------------------------------

const snapshotArgs = z.object({
  pair: pairSchema,
  intervals: z.array(intervalSchema).min(1).max(6).optional(),
  candleLimit: z.number().int().min(2).max(500).optional(),
  volatilityInterval: intervalSchema.optional(),
  asOf: z.number().int().optional(),
  maxAgeMs: z.number().int().min(0).nullable().optional(),
  fixtureScenario: z.string().optional(),
})

export async function readMarketSnapshot(argsJson: string): Promise<TradingToolResult> {
  const a = parse(snapshotArgs, argsJson)
  if ('__err' in a) return err('read_market_snapshot', a.__err)
  const provider = resolveProvider({ fixtureScenario: a.fixtureScenario as ScenarioId | undefined })
  if (!provider) return err('read_market_snapshot', 'no market source configured')

  const intervals = (a.intervals ?? ['1h', '4h']) as CandleInterval[]
  const snap = await assembleSnapshot(provider, {
    pair: a.pair,
    intervals,
    candleLimit: a.candleLimit ?? 100,
    volatilityInterval: (a.volatilityInterval ?? intervals[0]) as CandleInterval,
    ctx: ctxOf(a.asOf, a.maxAgeMs === undefined ? undefined : a.maxAgeMs),
  })
  return {
    ok: snap.truth !== 'UNAVAILABLE',
    data: snap,
    summary: `snapshot ${snap.pair} truth=${snap.truth} completeness=${(snap.completeness * 100).toFixed(0)}% executable=${snap.executable}`,
  }
}

// ---------------------------------------------------------------------------
// read_multi_timeframe_candles
// ---------------------------------------------------------------------------

const mtfArgs = z.object({
  pair: pairSchema,
  intervals: z.array(intervalSchema).min(1).max(6),
  limit: z.number().int().min(2).max(100).optional(),
  asOf: z.number().int().optional(),
  fixtureScenario: z.string().optional(),
})

async function readMultiTimeframeCandles(argsJson: string): Promise<TradingToolResult> {
  const a = parse(mtfArgs, argsJson)
  if ('__err' in a) return err('read_multi_timeframe_candles', a.__err)
  const provider = resolveProvider({ fixtureScenario: a.fixtureScenario as ScenarioId | undefined })
  if (!provider) return err('read_multi_timeframe_candles', 'no market source configured')

  const ctx = ctxOf(a.asOf)
  const out: Record<string, unknown> = {}
  let anyLive = false
  for (const interval of a.intervals) {
    const res = await provider.getCandles(a.pair, interval, a.limit ?? 100, ctx)
    out[interval] = {
      candles: res.value ?? [],
      count: res.value?.length ?? 0,
      truth: res.provenance.truth,
      source: res.provenance.source,
      source_timestamp: res.provenance.dataTimestamp,
      fetched_at: res.provenance.asOf,
      age_ms: res.provenance.ageMs,
      freshness_status: res.provenance.truth === 'LIVE' ? 'live' : 'unavailable',
    }
    if (res.provenance.truth !== 'UNAVAILABLE') anyLive = true
  }
  return {
    ok: anyLive,
    data: { pair: a.pair, byInterval: out },
    summary: `MTF candles ${a.pair} over ${a.intervals.join(',')} — ${anyLive ? 'ok' : 'all UNAVAILABLE'}`,
  }
}

// ---------------------------------------------------------------------------
// read_volatility_state
// ---------------------------------------------------------------------------

const volArgs = z.object({
  pair: pairSchema,
  interval: intervalSchema.optional(),
  limit: z.number().int().min(15).max(500).optional(),
  asOf: z.number().int().optional(),
  fixtureScenario: z.string().optional(),
})

export async function readVolatilityState(argsJson: string): Promise<TradingToolResult> {
  const a = parse(volArgs, argsJson)
  if ('__err' in a) return err('read_volatility_state', a.__err)
  const provider = resolveProvider({ fixtureScenario: a.fixtureScenario as ScenarioId | undefined })
  if (!provider) return err('read_volatility_state', 'no market source configured')
  const interval = (a.interval ?? '1h') as CandleInterval
  const res = await provider.getCandles(a.pair, interval, a.limit ?? 100, ctxOf(a.asOf))
  if (!res.value || res.value.length === 0) {
    return { ok: false, data: { volatility: null, truth: res.provenance.truth, reason: res.provenance.unavailableReason ?? 'no candles' }, summary: `volatility ${a.pair} UNAVAILABLE` }
  }
  const vol = computeVolatilityState(res.value)
  if (!vol) {
    return { ok: false, data: { volatility: null, truth: 'UNAVAILABLE', reason: 'series too short for ATR/stdev' }, summary: `volatility ${a.pair} UNAVAILABLE (short series)` }
  }
  return {
    ok: true,
    data: {
      volatility: vol,
      truth: res.provenance.truth,
      source: res.provenance.source,
      source_timestamp: res.provenance.dataTimestamp,
      fetched_at: res.provenance.asOf,
      age_ms: res.provenance.ageMs,
      candles_used: vol.window,
      freshness_status: res.provenance.truth === 'LIVE' ? 'live' : 'unavailable',
    },
    summary: `volatility ${a.pair} regime=${vol.regime} annualized=${vol.annualizedPct}% age=${res.provenance.ageMs}ms`,
  }
}

// ---------------------------------------------------------------------------
// read_market_structure
// ---------------------------------------------------------------------------

const structArgs = z.object({
  pair: pairSchema,
  interval: intervalSchema.optional(),
  intervals: z.array(intervalSchema).min(1).max(6).optional(),
  limit: z.number().int().min(15).max(100).optional(),
  asOf: z.number().int().optional(),
  fixtureScenario: z.string().optional(),
})
export async function readMarketStructure(argsJson: string): Promise<TradingToolResult> {
  const a = parse(structArgs, argsJson)
  if ('__err' in a) return err('read_market_structure', a.__err)
  const provider = resolveProvider({ fixtureScenario: a.fixtureScenario as ScenarioId | undefined })
  if (!provider) return err('read_market_structure', 'no market source configured')
  const intervals = (a.intervals ?? [a.interval ?? '1h']) as CandleInterval[]
  const ctx = ctxOf(a.asOf)
  const byTimeframe: Record<string, unknown> = {}
  const trends: string[] = []
  let freshestAge: number | null = null
  for (const interval of intervals) {
    const res = await provider.getCandles(a.pair, interval, a.limit ?? 100, ctx)
    const structure = res.value ? computeMarketStructure(res.value) : null
    const state = res.value && structure ? structureState(res.value, structure.trend) : null
    byTimeframe[interval] = {
      structure,
      state,
      truth: res.provenance.truth,
      source: res.provenance.source,
      source_timestamp: res.provenance.dataTimestamp,
      age_ms: res.provenance.ageMs,
      candles_used: res.value?.length ?? 0,
    }
    if (structure) trends.push(structure.trend)
    if (res.provenance.truth !== 'UNAVAILABLE') {
      freshestAge =
        freshestAge === null ? res.provenance.ageMs : Math.min(freshestAge, res.provenance.ageMs)
    }
  }
  if (trends.length === 0) {
    return {
      ok: false,
      data: { byTimeframe, coherence_score: null, truth: 'UNAVAILABLE' },
      summary: `structure ${a.pair} UNAVAILABLE`,
    }
  }
  const counts = new Map<string, number>()
  for (const trend of trends) counts.set(trend, (counts.get(trend) ?? 0) + 1)
  const coherence = Math.max(...counts.values()) / trends.length
  return {
    ok: true,
    data: {
      byTimeframe,
      coherence_score: coherence,
      freshness_status: 'live',
      age_ms: freshestAge,
    },
    summary: `structure ${a.pair} timeframes=${intervals.join(',')} coherence=${coherence.toFixed(2)} age=${freshestAge}ms`,
  }
}

// ---------------------------------------------------------------------------
// read_liquidity_snapshot — order-book backed, often UNAVAILABLE
// ---------------------------------------------------------------------------

const liqArgs = z.object({
  pair: pairSchema,
  depth: z.number().int().min(1).max(100).optional(),
  asOf: z.number().int().optional(),
  fixtureScenario: z.string().optional(),
})
export async function readLiquiditySnapshot(argsJson: string): Promise<TradingToolResult> {
  const a = parse(liqArgs, argsJson)
  if ('__err' in a) return err('read_liquidity_snapshot', a.__err)
  const provider = resolveProvider({ fixtureScenario: a.fixtureScenario as ScenarioId | undefined })
  if (!provider) return err('read_liquidity_snapshot', 'no market source configured')
  const res = await provider.getOrderBook(a.pair, a.depth ?? 20, ctxOf(a.asOf))
  if (!res.value) {
    return { ok: false, data: { liquidity: null, truth: res.provenance.truth, reason: res.provenance.unavailableReason }, summary: `liquidity ${a.pair} UNAVAILABLE (no order-book source)` }
  }
  const liquidity = liquidityFromOrderBook(res.value)
  return {
    ok: true,
    data: {
      liquidity,
      truth: res.provenance.truth,
      source: res.provenance.source,
      source_timestamp: res.provenance.dataTimestamp,
      fetched_at: res.provenance.asOf,
      age_ms: res.provenance.ageMs,
      freshness_status: res.provenance.truth === 'LIVE' ? 'live' : 'unavailable',
    },
    summary: `liquidity ${a.pair} spread=${liquidity.spreadBps ?? 'UNAVAILABLE'}bps imbalance=${liquidity.imbalance ?? 'UNAVAILABLE'} age=${res.provenance.ageMs}ms`,
  }
}

function structureState(
  candles: Array<{ high: string; low: string; close: string }>,
  trend: 'up' | 'down' | 'range',
): 'range' | 'trend' | 'breakout-up' | 'breakout-down' {
  if (candles.length < 3) return trend === 'range' ? 'range' : 'trend'
  const history = candles.slice(-21, -1)
  const last = Number(candles[candles.length - 1].close)
  const highs = history.map((candle) => Number(candle.high)).filter(Number.isFinite)
  const lows = history.map((candle) => Number(candle.low)).filter(Number.isFinite)
  if (highs.length && last > Math.max(...highs)) return 'breakout-up'
  if (lows.length && last < Math.min(...lows)) return 'breakout-down'
  return trend === 'range' ? 'range' : 'trend'
}

// ---------------------------------------------------------------------------
// read_funding_open_interest — perp-only, often UNAVAILABLE
// ---------------------------------------------------------------------------

export async function readFundingOpenInterest(argsJson: string): Promise<TradingToolResult> {
  const a = parse(liqArgs.omit({ depth: true }), argsJson)
  if ('__err' in a) return err('read_funding_open_interest', a.__err)
  const provider = resolveProvider({ fixtureScenario: a.fixtureScenario as ScenarioId | undefined })
  if (!provider) return err('read_funding_open_interest', 'no market source configured')
  const res = await provider.getFundingOpenInterest(a.pair, ctxOf(a.asOf))
  if (!res.value) {
    return { ok: false, data: { fundingOpenInterest: null, truth: res.provenance.truth, reason: res.provenance.unavailableReason }, summary: `funding/OI ${a.pair} UNAVAILABLE (no perp source)` }
  }
  return { ok: true, data: { fundingOpenInterest: res.value, truth: res.provenance.truth }, summary: `funding/OI ${a.pair} ok` }
}

// ---------------------------------------------------------------------------
// read_derivatives_snapshot — Binance USD-M Futures public reads.
// ---------------------------------------------------------------------------

/**
 * The derivatives provider (derivatives.ts) is BTCUSDT-only — every Binance
 * futures URL it builds hardcodes that symbol. The tool's argument schema
 * therefore accepts `symbol: 'BTCUSDT'` and nothing else.
 *
 * That schema silently swallowed the wrong question. Zod's default is to STRIP
 * unknown keys, so `{"pair":"ETHUSDT"}` parsed clean, `symbol` stayed undefined,
 * and the handler answered with BTC data under a summary that says "BTCUSDT" —
 * an ETH-specialist agent asking for ETH derivatives got BTC funding and open
 * interest, with no error and nothing in the reply marking the substitution.
 * Measured 2026-07-26 while validating ETH tool coverage: requested ETHUSDT,
 * received `symbol: BTCUSDT`, `ok: true`.
 *
 * This is the failure mode AGENTS.md names: "donnée absente → UNAVAILABLE avec
 * provenance, jamais inventée". Answering a different instrument than the one
 * asked for is worse than answering nothing, because it reads as an answer.
 *
 * `pair` is accepted (it is the field name EVERY other market tool uses, which
 * is precisely why a model reaches for it here) and any non-BTCUSDT value is
 * refused as UNAVAILABLE with the reason, instead of being quietly discarded.
 */
const derivativesArgs = z.object({
  symbol: z.literal('BTCUSDT').optional(),
  pair: z.string().optional(),
  asOf: z.number().int().optional(),
})
const DERIVATIVES_SUPPORTED_SYMBOL = 'BTCUSDT'

async function readDerivativesSnapshot(argsJson: string): Promise<TradingToolResult> {
  const a = parse(derivativesArgs, argsJson)
  if ('__err' in a) return err('read_derivatives_snapshot', a.__err)
  // A caller that named an instrument must get THAT instrument or an explicit
  // refusal — never a silent substitution.
  const requested = a.pair ?? a.symbol
  if (requested !== undefined && requested !== DERIVATIVES_SUPPORTED_SYMBOL) {
    return {
      ok: false,
      data: {
        derivatives: null,
        truth: 'UNAVAILABLE',
        requested,
        supported: [DERIVATIVES_SUPPORTED_SYMBOL],
        reason: 'derivatives-coverage-limited',
      },
      summary:
        `derivatives UNAVAILABLE for ${requested} — this tool covers ${DERIVATIVES_SUPPORTED_SYMBOL} only ` +
        `(Binance USD-M futures reads are BTC-only here). No substitute instrument is returned.`,
    }
  }
  try {
    const snapshot = await readLiveDerivativesSnapshot(a.asOf)
    return {
      ok: snapshot.freshness_status !== 'unavailable',
      data: { derivatives: snapshot },
      summary: `derivatives ${DERIVATIVES_SUPPORTED_SYMBOL} regime=${snapshot.derivatives_regime} funding=${snapshot.funding_rate ?? 'UNAVAILABLE'} OI=${snapshot.open_interest_usd ?? 'UNAVAILABLE'}USD freshness=${snapshot.freshness_status}`,
    }
  } catch (error) {
    console.error(
      '[market/tools] derivatives snapshot failed',
      error instanceof Error ? error.message : 'unknown error',
    )
    return err('read_derivatives_snapshot', 'Binance Futures data unavailable')
  }
}

// ---------------------------------------------------------------------------
// read_account_risk_snapshot — exact account id, never first/random account.
// ---------------------------------------------------------------------------

const acctArgs = z.object({
  accountId: z.string().min(1).optional(),
  requestedWithdrawalUsd: z.number().positive().optional(),
  asOf: z.number().int().optional(),
})
export async function readAccountRiskSnapshot(argsJson: string): Promise<TradingToolResult> {
  const a = parse(acctArgs, argsJson)
  if ('__err' in a) return err('read_account_risk_snapshot', a.__err)
  if (!a.accountId) {
    return {
      ok: false,
      data: { accountRisk: null, account_required: true },
      summary: 'account risk unavailable: account_required',
    }
  }
  const asOf = a.asOf ?? Date.now()
  const account = await readAccountRisk(a.accountId, asOf)
  if (!account) {
    return {
      ok: false,
      data: { accountRisk: null, account_required: false, reason: 'account_not_found' },
      summary: 'account risk unavailable: exact account not found via TradeAgent portfolio risk route or configured snapshots',
    }
  }
  const provider = new BinanceMarketProvider()
  const ctx = ctxOf(asOf, 60_000)
  const [tickerResult, candlesResult, orderBookResult, derivatives] = await Promise.all([
    provider.getTicker('BTCUSDT', ctx),
    provider.getCandles('BTCUSDT', '1h', 100, ctx),
    provider.getOrderBook('BTCUSDT', 20, ctx),
    readLiveDerivativesSnapshot(asOf),
  ])
  const volatility = candlesResult.value
    ? computeVolatilityState(candlesResult.value, { atrWindow: 14, stdevWindow: 20 })
    : null
  const liquidity = orderBookResult.value
    ? liquidityFromOrderBook(orderBookResult.value)
    : null
  const risk = calculateRisk({
    account,
    spotPrice: tickerResult.value?.last ?? null,
    volatility,
    liquidity,
    derivatives,
    requestedWithdrawalUsd: a.requestedWithdrawalUsd,
  })
  return {
    ok: risk.risk_score !== null,
    data: {
      accountRisk: account,
      riskAssessment: risk,
      market_inputs: {
        spot_price: tickerResult.value?.last ?? null,
        volatility,
        liquidity,
        derivatives,
      },
    },
    summary: `account risk score=${risk.risk_score ?? 'UNAVAILABLE'} level=${risk.risk_level} lock=${risk.lock_recommendation} withdrawal=${risk.withdrawal_recommendation}`,
  }
}

// ---------------------------------------------------------------------------
// read_macro_context — context-only; correlation reads on BTC pairs allowed.
// Derives a coarse macro tape from BTC + ETH structure. Context, never a trade.
// ---------------------------------------------------------------------------

const macroArgs = z.object({
  asOf: z.number().int().optional(),
  fixtureScenario: z.string().optional(),
})
export async function readMacroContext(argsJson: string): Promise<TradingToolResult> {
  const a = parse(macroArgs, argsJson)
  if ('__err' in a) return err('read_macro_context', a.__err)
  const provider = resolveProvider({ fixtureScenario: a.fixtureScenario as ScenarioId | undefined })
  if (!provider) return err('read_macro_context', 'no market source configured')
  const ctx = ctxOf(a.asOf)
  const legs: Array<{ pair: PairSymbol; role: string }> = [
    { pair: 'BTCUSDT', role: 'context' },
    { pair: 'ETHUSDT', role: 'executable' },
  ]
  const tape: Record<string, unknown> = {}
  let anyOk = false
  for (const leg of legs) {
    const res = await provider.getCandles(leg.pair, '4h', 100, ctx)
    const structure = res.value ? computeMarketStructure(res.value) : null
    tape[leg.pair] = {
      role: leg.role,
      executable: isExecutablePair(leg.pair),
      trend: structure?.trend ?? null,
      truth: res.provenance.truth,
    }
    if (structure) anyOk = true
  }
  return {
    ok: anyOk,
    data: { tape, note: 'context only — BTC legs are correlation context, never an executable recommendation' },
    summary: `macro context ${anyOk ? 'derived' : 'UNAVAILABLE'} (BTC context + ETH executable)`,
  }
}

// ---------------------------------------------------------------------------
// Registry — keyed by manifest tool name.
// ---------------------------------------------------------------------------

export type TradingToolHandler = (argsJson: string) => Promise<TradingToolResult>

export const TRADING_TOOL_HANDLERS: Readonly<Record<string, TradingToolHandler>> = {
  read_market_snapshot: readMarketSnapshot,
  read_multi_timeframe_candles: readMultiTimeframeCandles,
  read_volatility_state: readVolatilityState,
  read_market_structure: readMarketStructure,
  read_liquidity_snapshot: readLiquiditySnapshot,
  read_funding_open_interest: readFundingOpenInterest,
  read_derivatives_snapshot: readDerivativesSnapshot,
  read_account_risk_snapshot: readAccountRiskSnapshot,
  read_macro_context: readMacroContext,
}

export const TRADING_TOOL_IDS = Object.keys(TRADING_TOOL_HANDLERS)
