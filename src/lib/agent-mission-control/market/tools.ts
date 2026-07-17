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
import { FixtureMarketProvider } from './fixtures/fixture-provider'
import type { ScenarioId } from './fixtures/scenarios'
import { assembleSnapshot } from './assembler'
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
import { unavailableProvenance } from './truth'

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
  const base = args.baseUrl ?? process.env.TRADEAGENT_MARKET_URL ?? null
  if (base) return new HttpMarketProvider({ baseUrl: base })
  // EVAL-ONLY fallback: with no live URL, an operator can pin a frozen fixture
  // scenario via AIG_MARKET_FIXTURE so agents can be benchmarked offline. Data
  // served this way is ALWAYS truth: 'FIXTURE' (the FixtureMarketProvider tags
  // it so) — it can never be mistaken for LIVE. Absent both → UNAVAILABLE.
  const envFixture = process.env.AIG_MARKET_FIXTURE as ScenarioId | undefined
  if (envFixture) return new FixtureMarketProvider(envFixture)
  return null
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
  if (!provider) return err('read_market_snapshot', 'no market source configured (set TRADEAGENT_MARKET_URL or pass fixtureScenario in lab)')

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
  limit: z.number().int().min(2).max(500).optional(),
  asOf: z.number().int().optional(),
  fixtureScenario: z.string().optional(),
})

export async function readMultiTimeframeCandles(argsJson: string): Promise<TradingToolResult> {
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
  return { ok: true, data: { volatility: vol, truth: res.provenance.truth, source: res.provenance.source }, summary: `volatility ${a.pair} regime=${vol.regime} annualized=${vol.annualizedPct}%` }
}

// ---------------------------------------------------------------------------
// read_market_structure
// ---------------------------------------------------------------------------

const structArgs = volArgs
export async function readMarketStructure(argsJson: string): Promise<TradingToolResult> {
  const a = parse(structArgs, argsJson)
  if ('__err' in a) return err('read_market_structure', a.__err)
  const provider = resolveProvider({ fixtureScenario: a.fixtureScenario as ScenarioId | undefined })
  if (!provider) return err('read_market_structure', 'no market source configured')
  const interval = (a.interval ?? '1h') as CandleInterval
  const res = await provider.getCandles(a.pair, interval, a.limit ?? 100, ctxOf(a.asOf))
  if (!res.value || res.value.length === 0) {
    return { ok: false, data: { structure: null, truth: res.provenance.truth }, summary: `structure ${a.pair} UNAVAILABLE` }
  }
  const structure = computeMarketStructure(res.value)
  if (!structure) {
    return { ok: false, data: { structure: null, truth: 'UNAVAILABLE', reason: 'series too short' }, summary: `structure ${a.pair} UNAVAILABLE (short series)` }
  }
  return { ok: true, data: { structure, truth: res.provenance.truth, source: res.provenance.source }, summary: `structure ${a.pair} trend=${structure.trend}` }
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
  return { ok: true, data: { orderBook: res.value, truth: res.provenance.truth }, summary: `liquidity ${a.pair} ok` }
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
// read_account_risk_snapshot — no account-read source wired → UNAVAILABLE.
// A real integration would read a TradeAgent read-only account endpoint; none
// is exposed publicly, so this HONESTLY returns UNAVAILABLE rather than a fake
// capital figure (invariant #8, Sentinel's "never fabricate capital").
// ---------------------------------------------------------------------------

const acctArgs = z.object({
  pair: pairSchema.optional(),
  asOf: z.number().int().optional(),
})
export async function readAccountRiskSnapshot(argsJson: string): Promise<TradingToolResult> {
  const a = parse(acctArgs, argsJson)
  if ('__err' in a) return err('read_account_risk_snapshot', a.__err)
  const prov = unavailableProvenance({
    source: 'account-risk',
    sourceType: 'composite',
    asOf: a.asOf ?? Date.now(),
    reason: 'no read-only account/exposure source is exposed by TradeAgent; capital is never fabricated',
  })
  return {
    ok: false,
    data: { accountRisk: null, truth: prov.truth, reason: prov.unavailableReason },
    summary: 'account risk UNAVAILABLE — no account source (capital never fabricated)',
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
  read_account_risk_snapshot: readAccountRiskSnapshot,
  read_macro_context: readMacroContext,
}

export const TRADING_TOOL_IDS = Object.keys(TRADING_TOOL_HANDLERS)
