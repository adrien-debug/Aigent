/**
 * AIG-TRADE-001 — per-contract output-format hints for the model (V2).
 *
 * The V1 agents emitted structurally-correct-looking JSON but missed the exact
 * field types (e.g. `sources` as objects instead of plain strings). These hints
 * spell out the precise shape so the model's JSON validates against the Zod
 * contract. Appended to an agent's system prompt at V2 materialization — a
 * bounded, behaviour-only patch (no tool change), exactly what the improvement
 * loop permits.
 *
 * The mission rule stays intact: respond with ONLY the JSON object, prices as
 * lossless decimal strings, arrays of plain strings unless a shape is given,
 * and abstain honestly (lean/verdict UNAVAILABLE) when data is insufficient —
 * never fabricate.
 */
import type { OutputContractName } from './contracts'

const FRESHNESS =
  'freshness: { truth: "LIVE"|"SNAPSHOT"|"HISTORICAL"|"FIXTURE"|"FALLBACK"|"UNAVAILABLE", asOf: number(epoch ms), sources: array of { block: string, truth: same-enum, source: string } (>=1), unavailable: array of string }'
const CONCLUSION =
  'conclusion: { lean: "bullish"|"bearish"|"neutral"|"none", horizon: string, invalidation: string, risk: string, confidence: number 0..1 }'

export const CONTRACT_PROMPT_HINTS: Readonly<Record<OutputContractName, string>> = {
  TechnicalAnalysisReport: [
    'Respond with ONLY a JSON object (no prose, no markdown fences) with EXACTLY these fields:',
    'contractVersion: "v1.0.0", kind: "TechnicalAnalysisReport", instrument: "ETHUSDT"|"ETHUSDC"|"BTCUSDT"|"BTCUSDC", executable: boolean,',
    FRESHNESS + ',',
    'horizons: array of ("1m"|"5m"|"15m"|"1h"|"4h"|"1d"), regime: "trend"|"range"|"transition"|"unknown",',
    'keyLevels: { supports: array of decimal-string, resistances: array of decimal-string },',
    'primaryScenario: string, alternativeScenarios: array of string (>=1), catalysts: array of string,',
    CONCLUSION + '.',
    'Prices are decimal STRINGS like "3421.55", never numbers.',
  ].join(' '),
  QuantRegimeReport: [
    'Respond with ONLY a JSON object with EXACTLY these fields:',
    'contractVersion: "v1.0.0", kind: "QuantRegimeReport", instrument: "ETHUSDT"|"ETHUSDC"|"BTCUSDT"|"BTCUSDC", executable: boolean,',
    FRESHNESS + ',',
    'featuresUsed: array of string (>=1), regime: "trend"|"range"|"transition"|"unknown",',
    'signalScores: array of { signal: string, score: number -1..1 } (>=1),',
    'confluence: number -1..1, stability: number 0..1, sampleSize: integer, statisticalLimits: array of string (>=1),',
    CONCLUSION + '.',
  ].join(' '),
  RiskAssessment: [
    'Respond with ONLY a JSON object with EXACTLY these fields:',
    'contractVersion: "v1.0.0", kind: "RiskAssessment", instrument: pair-enum, executable: boolean,',
    FRESHNESS + ',',
    'referenceCapital: decimal-string OR null, capitalProvenance: truth-enum, riskPerIdea: decimal-string|null, maxSize: decimal-string|null,',
    'exposureBefore: decimal-string|null, exposureAfter: decimal-string|null, invalidationDistance: decimal-string|null,',
    'theoreticalLoss: decimal-string|null, drawdown: decimal-string|null, limitsTriggered: array of string,',
    'verdict: "ALLOWED"|"REDUCE"|"BLOCKED"|"UNAVAILABLE", justification: string.',
    'If account/capital data is UNAVAILABLE, set referenceCapital null, capitalProvenance "UNAVAILABLE", verdict "UNAVAILABLE" — NEVER invent capital.',
  ].join(' '),
  ExecutionAssessment: [
    'Respond with ONLY a JSON object with EXACTLY these fields:',
    'contractVersion: "v1.0.0", kind: "ExecutionAssessment", instrument: pair-enum, executable: boolean,',
    FRESHNESS + ',',
    'liquidityState: "deep"|"normal"|"thin"|"illiquid"|"unavailable", spread: decimal-string|null,',
    'volatility: "low"|"normal"|"elevated"|"high"|"unavailable", executionQuality: "good"|"acceptable"|"poor"|"do-not-execute",',
    'entryWindow: string, abortConditions: array of string (>=1),',
    'estimatedSlippage: { value: decimal-string|null, method: string }, confidence: number 0..1.',
    'If the order book is UNAVAILABLE, set liquidityState "unavailable", spread null, and abstain in entryWindow — never invent depth.',
  ].join(' '),
  MacroContextReport: [
    'Respond with ONLY a JSON object with EXACTLY these fields:',
    'contractVersion: "v1.0.0", kind: "MacroContextReport",',
    FRESHNESS + ',',
    'events: array of { event: string, date: string, source: string, kind: "fact"|"scheduled"|"correlation"|"hypothesis" },',
    'marketState: string, favorableFactors: array of string, unfavorableFactors: array of string,',
    'transmissionToEth: array of string (>=1), uncertainty: number 0..1, horizon: string, eventRisks: array of string.',
    'BTC is context only, never an executable recommendation.',
  ].join(' '),
  EducationalLesson: [
    'Respond with ONLY a JSON object with EXACTLY these fields:',
    'contractVersion: "v1.0.0", kind: "EducationalLesson", objective: string, prerequisites: array of string,',
    'explanation: string, example: string, commonMistake: string, exercise: string, correction: string,',
    'warning: string, sources: array of PLAIN STRINGS (not objects).',
    'The warning must be educational and must NEVER promise a return.',
  ].join(' '),
}
