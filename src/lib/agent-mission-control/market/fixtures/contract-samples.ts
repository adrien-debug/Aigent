/**
 * AIG-TRADE-001 — valid + invalid sample payloads per output contract (Lot 3).
 *
 * Lab-only. Each contract has a KNOWN-GOOD sample (validates) and a set of
 * KNOWN-BAD samples (each violates exactly one invariant), so the contract's
 * enforcement is provable. These are also the golden shapes the delivery
 * package documents.
 */

import { CONTRACT_VERSION } from '../contracts'
import type { OutputContractName } from '../contracts'

const freshnessGood = {
  truth: 'SNAPSHOT',
  asOf: 1_767_225_600_000,
  sources: [{ block: 'candles:1h', truth: 'SNAPSHOT', source: 'fixture:trend-up' }],
  unavailable: ['liquidity', 'fundingOpenInterest'],
}

const conclusionGood = {
  lean: 'bullish',
  horizon: '4h-1d',
  invalidation: 'close below 3180 on 4h',
  risk: 'macro shock; thin weekend liquidity',
  confidence: 0.55,
}

export const VALID_SAMPLES: Record<OutputContractName, unknown> = {
  TechnicalAnalysisReport: {
    contractVersion: CONTRACT_VERSION,
    kind: 'TechnicalAnalysisReport',
    instrument: 'ETHUSDT',
    executable: true,
    freshness: freshnessGood,
    horizons: ['1h', '4h'],
    regime: 'trend',
    keyLevels: { supports: ['3180.00', '3120.50'], resistances: ['3420.00'] },
    primaryScenario: 'Continuation toward 3420 while above 3180.',
    alternativeScenarios: ['Rejection at 3420 back into the 3200 range.'],
    catalysts: ['ETF flows', 'FOMC minutes'],
    conclusion: conclusionGood,
  },
  QuantRegimeReport: {
    contractVersion: CONTRACT_VERSION,
    kind: 'QuantRegimeReport',
    instrument: 'ETHUSDT',
    executable: true,
    freshness: freshnessGood,
    featuresUsed: ['atr', 'stdevReturns', 'trend-slope'],
    regime: 'trend',
    signalScores: [
      { signal: 'trend-slope', score: 0.6 },
      { signal: 'vol-regime', score: -0.2 },
    ],
    confluence: 0.4,
    stability: 0.8,
    sampleSize: 60,
    statisticalLimits: ['single-source fixture; not out-of-sample validated'],
    conclusion: { ...conclusionGood, lean: 'bullish' },
  },
  RiskAssessment: {
    contractVersion: CONTRACT_VERSION,
    kind: 'RiskAssessment',
    instrument: 'ETHUSDT',
    executable: true,
    freshness: { ...freshnessGood, unavailable: ['accountRisk'] },
    referenceCapital: null,
    capitalProvenance: 'UNAVAILABLE',
    riskPerIdea: null,
    maxSize: null,
    exposureBefore: null,
    exposureAfter: null,
    invalidationDistance: '40.00',
    theoreticalLoss: null,
    drawdown: null,
    limitsTriggered: [],
    verdict: 'UNAVAILABLE',
    justification: 'No account/exposure source available — cannot size; capital never fabricated.',
  },
  ExecutionAssessment: {
    contractVersion: CONTRACT_VERSION,
    kind: 'ExecutionAssessment',
    instrument: 'ETHUSDT',
    executable: true,
    freshness: { ...freshnessGood, unavailable: ['liquidity'] },
    liquidityState: 'unavailable',
    spread: null,
    volatility: 'normal',
    executionQuality: 'acceptable',
    entryWindow: 'Wait for spread confirmation; no order-book source in this run.',
    abortConditions: ['spread > 15bps', 'no depth data'],
    estimatedSlippage: { value: null, method: 'unavailable — no order book' },
    confidence: 0.3,
  },
  MacroContextReport: {
    contractVersion: CONTRACT_VERSION,
    kind: 'MacroContextReport',
    freshness: freshnessGood,
    events: [
      { event: 'FOMC minutes', date: '2026-01-08', source: 'calendar', kind: 'scheduled' },
    ],
    marketState: 'Risk-neutral; BTC leading, ETH beta ~1.1.',
    favorableFactors: ['ETF inflows'],
    unfavorableFactors: ['rate uncertainty'],
    transmissionToEth: ['BTC dominance shifts ETH beta', 'DXY inverse correlation'],
    uncertainty: 0.5,
    horizon: '1-3d',
    eventRisks: ['FOMC surprise'],
  },
  EducationalLesson: {
    contractVersion: CONTRACT_VERSION,
    kind: 'EducationalLesson',
    objective: 'Understand what ATR measures and does NOT measure.',
    prerequisites: ['candlestick basics'],
    explanation: 'ATR is the average true range — a volatility magnitude, not a direction.',
    example: 'On the 1h ETH series, ATR≈24 means ~24 USDT typical bar range.',
    commonMistake: 'Treating a rising ATR as a bullish signal.',
    exercise: 'Given three candles, compute the true range of the last.',
    correction: 'TR = max(H-L, |H-prevClose|, |L-prevClose|).',
    warning: 'Volatility tools describe risk; they never promise a return.',
    sources: ['read_volatility_state tool output'],
  },
}

/** Each bad sample: a shallow-cloned good sample with ONE invariant broken. */
export const INVALID_SAMPLES: Record<OutputContractName, Array<{ why: string; payload: unknown }>> = {
  TechnicalAnalysisReport: [
    {
      why: 'confidence out of [0,1]',
      payload: {
        ...(VALID_SAMPLES.TechnicalAnalysisReport as object),
        conclusion: { ...conclusionGood, confidence: 1.4 },
      },
    },
    {
      why: 'bare signal — missing invalidation',
      payload: {
        ...(VALID_SAMPLES.TechnicalAnalysisReport as object),
        conclusion: { lean: 'bullish', horizon: '4h', risk: 'x', confidence: 0.5 },
      },
    },
    {
      why: 'float price instead of decimal string',
      payload: {
        ...(VALID_SAMPLES.TechnicalAnalysisReport as object),
        keyLevels: { supports: [3180.0 as unknown as string], resistances: [] },
      },
    },
  ],
  QuantRegimeReport: [
    {
      why: 'signal score out of [-1,1]',
      payload: {
        ...(VALID_SAMPLES.QuantRegimeReport as object),
        signalScores: [{ signal: 'x', score: 2 }],
      },
    },
    {
      why: 'missing statisticalLimits',
      payload: (() => {
        const p = { ...(VALID_SAMPLES.QuantRegimeReport as Record<string, unknown>) }
        delete p.statisticalLimits
        return p
      })(),
    },
  ],
  RiskAssessment: [
    {
      why: 'invalid verdict enum',
      payload: { ...(VALID_SAMPLES.RiskAssessment as object), verdict: 'BUY' },
    },
    {
      why: 'missing justification',
      payload: (() => {
        const p = { ...(VALID_SAMPLES.RiskAssessment as Record<string, unknown>) }
        delete p.justification
        return p
      })(),
    },
  ],
  ExecutionAssessment: [
    {
      why: 'invalid executionQuality enum',
      payload: { ...(VALID_SAMPLES.ExecutionAssessment as object), executionQuality: 'great' },
    },
    {
      why: 'empty abortConditions',
      payload: { ...(VALID_SAMPLES.ExecutionAssessment as object), abortConditions: [] },
    },
  ],
  MacroContextReport: [
    {
      why: 'empty transmissionToEth',
      payload: { ...(VALID_SAMPLES.MacroContextReport as object), transmissionToEth: [] },
    },
    {
      why: 'uncertainty out of [0,1]',
      payload: { ...(VALID_SAMPLES.MacroContextReport as object), uncertainty: 3 },
    },
  ],
  EducationalLesson: [
    {
      why: 'missing warning (return-promise guard)',
      payload: (() => {
        const p = { ...(VALID_SAMPLES.EducationalLesson as Record<string, unknown>) }
        delete p.warning
        return p
      })(),
    },
  ],
}
