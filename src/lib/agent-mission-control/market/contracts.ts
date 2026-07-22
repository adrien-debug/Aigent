/**
 * AIG-TRADE-001 — versioned output contracts (Lot 3).
 *
 * The six structured reports the copilots must produce. Each is a Zod schema,
 * validated at runtime; a critical field missing → the report is REJECTED
 * (never silently coerced). Every contract enforces the mission invariants:
 *
 *   - provenance + freshness carried on every report (invariant #7);
 *   - unavailability is representable and must be stated, not hidden (#8);
 *   - scores/confidence bounded to [0,1] (#12);
 *   - facts are separated from interpretation (bias/scenario ≠ observation);
 *   - NO bare BUY/SELL: an actionable conclusion carries horizon + invalidation
 *     + risk + confidence (#12);
 *   - the executable universe is respected (#14): an instrument flagged
 *     non-executable can be described but never recommended as a trade.
 *
 * Contracts are versioned (`CONTRACT_VERSION`) so a delivered agent and the
 * consumer (TradeAgent) can pin a shape. Reusable in TradeAgent (invariant:
 * "être réutilisable dans TradeAgent") — pure Zod, no server import.
 */

import { z } from 'zod'
import { PAIR_SYMBOLS, CANDLE_INTERVALS } from './snapshot'
import { TRUTH_STATUSES } from './truth'

export const CONTRACT_VERSION = 'v1.0.0'

// Shared primitives -----------------------------------------------------------

const confidence = z
  .number()
  .min(0)
  .max(1)
  .describe('Calibrated confidence in [0,1]. 1 = certain.')

const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'must be a lossless decimal string, not a float')

const truthStatus = z.enum(TRUTH_STATUSES as unknown as [string, ...string[]])
const pair = z.enum(PAIR_SYMBOLS as unknown as [string, ...string[]])
const interval = z.enum(CANDLE_INTERVALS as unknown as [string, ...string[]])

/** Provenance every report must carry so nothing is presented as LIVE falsely. */
const freshnessMetaSchema = z.object({
  truth: truthStatus,
  asOf: z.number().int(),
  /** Sources actually consulted, each with its own truth. */
  sources: z
    .array(
      z.object({
        block: z.string().min(1),
        truth: truthStatus,
        source: z.string().min(1),
      }),
    )
    .min(1),
  /** Blocks that were UNAVAILABLE — explicitly listed, never hidden. */
  unavailable: z.array(z.string()),
})

/** A tri-state degree so an agent can abstain honestly. */
const conclusionSchema = z.object({
  /** Coarse actionable lean. 'none' = insufficient data → abstain. */
  lean: z.enum(['bullish', 'bearish', 'neutral', 'none']),
  horizon: z.string().min(1).describe('Time horizon, e.g. "4h-1d". Required.'),
  invalidation: z
    .string()
    .min(1)
    .describe('What price/condition invalidates this. Required — no bare signal.'),
  risk: z.string().min(1).describe('Primary risk to this view. Required.'),
  confidence,
})

const commonBase = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  instrument: pair,
  executable: z.boolean(),
  freshness: freshnessMetaSchema,
})

// 1. TechnicalAnalysisReport (Atlas) -----------------------------------------

export const technicalAnalysisReportSchema = commonBase.extend({
  kind: z.literal('TechnicalAnalysisReport'),
  horizons: z.array(interval).min(1),
  regime: z.enum(['trend', 'range', 'transition', 'unknown']),
  keyLevels: z.object({
    supports: z.array(decimalString),
    resistances: z.array(decimalString),
  }),
  primaryScenario: z.string().min(1),
  alternativeScenarios: z.array(z.string()).min(1),
  catalysts: z.array(z.string()),
  conclusion: conclusionSchema,
})

// 2. QuantRegimeReport (Vector) ----------------------------------------------

export const quantRegimeReportSchema = commonBase.extend({
  kind: z.literal('QuantRegimeReport'),
  featuresUsed: z.array(z.string()).min(1),
  regime: z.enum(['trend', 'range', 'transition', 'unknown']),
  signalScores: z
    .array(z.object({ signal: z.string().min(1), score: z.number().min(-1).max(1) }))
    .min(1),
  confluence: z.number().min(-1).max(1),
  stability: z.number().min(0).max(1),
  sampleSize: z.number().int().min(0),
  statisticalLimits: z.array(z.string()).min(1),
  conclusion: conclusionSchema,
})

// 3. RiskAssessment (Sentinel) -----------------------------------------------

export const riskAssessmentSchema = commonBase.extend({
  kind: z.literal('RiskAssessment'),
  referenceCapital: decimalString.nullable(),
  capitalProvenance: truthStatus,
  riskPerIdea: decimalString.nullable(),
  maxSize: decimalString.nullable(),
  exposureBefore: decimalString.nullable(),
  exposureAfter: decimalString.nullable(),
  invalidationDistance: decimalString.nullable(),
  theoreticalLoss: decimalString.nullable(),
  drawdown: decimalString.nullable(),
  limitsTriggered: z.array(z.string()),
  verdict: z.enum(['ALLOWED', 'REDUCE', 'BLOCKED', 'UNAVAILABLE']),
  justification: z.string().min(1),
})

// 4. ExecutionAssessment (Pulse) ---------------------------------------------

export const executionAssessmentSchema = commonBase.extend({
  kind: z.literal('ExecutionAssessment'),
  liquidityState: z.enum(['deep', 'normal', 'thin', 'illiquid', 'unavailable']),
  spread: decimalString.nullable(),
  volatility: z.enum(['low', 'normal', 'elevated', 'high', 'unavailable']),
  executionQuality: z.enum(['good', 'acceptable', 'poor', 'do-not-execute']),
  entryWindow: z.string().min(1),
  abortConditions: z.array(z.string()).min(1),
  estimatedSlippage: z.object({
    value: decimalString.nullable(),
    method: z.string().min(1),
  }),
  confidence,
})

// 5. MacroContextReport (Meridian) -------------------------------------------

export const macroContextReportSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  kind: z.literal('MacroContextReport'),
  freshness: freshnessMetaSchema,
  events: z.array(
    z.object({
      event: z.string().min(1),
      date: z.string().min(1),
      source: z.string().min(1),
      kind: z.enum(['fact', 'scheduled', 'correlation', 'hypothesis']),
    }),
  ),
  marketState: z.string().min(1),
  favorableFactors: z.array(z.string()),
  unfavorableFactors: z.array(z.string()),
  /** How macro transmits to the ETH-only executable universe. */
  transmissionToEth: z.array(z.string()).min(1),
  uncertainty: z.number().min(0).max(1),
  horizon: z.string().min(1),
  eventRisks: z.array(z.string()),
})

// 6. EducationalLesson (Sage) ------------------------------------------------

export const educationalLessonSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  kind: z.literal('EducationalLesson'),
  objective: z.string().min(1),
  prerequisites: z.array(z.string()),
  explanation: z.string().min(1),
  example: z.string().min(1),
  commonMistake: z.string().min(1),
  exercise: z.string().min(1),
  correction: z.string().min(1),
  warning: z
    .string()
    .min(1)
    .describe('Educational, never a return promise (invariant #4).'),
  sources: z.array(z.string()),
})

// Registry -------------------------------------------------------------------

export const OUTPUT_CONTRACTS = {
  TechnicalAnalysisReport: technicalAnalysisReportSchema,
  QuantRegimeReport: quantRegimeReportSchema,
  RiskAssessment: riskAssessmentSchema,
  ExecutionAssessment: executionAssessmentSchema,
  MacroContextReport: macroContextReportSchema,
  EducationalLesson: educationalLessonSchema,
} as const

export type OutputContractName = keyof typeof OUTPUT_CONTRACTS

export type TechnicalAnalysisReport = z.infer<typeof technicalAnalysisReportSchema>
export type QuantRegimeReport = z.infer<typeof quantRegimeReportSchema>
export type RiskAssessment = z.infer<typeof riskAssessmentSchema>
export type ExecutionAssessment = z.infer<typeof executionAssessmentSchema>
export type MacroContextReport = z.infer<typeof macroContextReportSchema>
export type EducationalLesson = z.infer<typeof educationalLessonSchema>

export interface ContractValidation {
  ok: boolean
  errors: string[]
}

/** Validate an unknown payload against a named contract. Never throws. */
export function validateContract(
  name: OutputContractName,
  payload: unknown,
): ContractValidation {
  const schema = OUTPUT_CONTRACTS[name] as z.ZodType
  const r = schema.safeParse(payload)
  if (r.success) return { ok: true, errors: [] }
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  }
}
