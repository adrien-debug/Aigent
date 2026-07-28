/**
 * Post-run quality signals for TradeAgent market copilots on operator paths.
 * Pure — no IO. Used by the runner (advisory step) and scorecard scripts.
 */

export const MARKET_INTELLIGENCE_TOOL_IDS = [
  'read_market_snapshot',
  'read_multi_timeframe_candles',
  'read_volatility_state',
  'read_market_structure',
  'read_liquidity_snapshot',
] as const

export type OperatorRunQuality = {
  /** Unique declared tools invoked. */
  uniqueToolCount: number
  /** Fraction of declared tools used (0..1). */
  toolBreadth: number
  /** True when uniqueToolCount >= minRequiredTools. */
  toolBreadthOk: boolean
  /** Output mentions provider/freshness/live/binance (heuristic). */
  provenanceMentioned: boolean
  missingTools: string[]
  warnings: string[]
}

const PROVENANCE_RE = /\b(provider|freshness|live|binance|as[- ]of|truth)\b/i

/**
 * Grade an operator run for Market Intelligence tool breadth + provenance prose.
 * Does NOT validate the full Zod output contract — that stays on benchmark paths.
 */
export function assessMarketIntelligenceOperatorRun(input: {
  actualToolNames: readonly string[]
  outputText: string
  minRequiredTools?: number
  declaredTools?: readonly string[]
}): OperatorRunQuality {
  const declared = input.declaredTools ?? MARKET_INTELLIGENCE_TOOL_IDS
  const minRequired = input.minRequiredTools ?? 4
  const unique = [...new Set(input.actualToolNames)]
  const missingTools = declared.filter((t) => !unique.includes(t))
  const toolBreadth = declared.length === 0 ? 1 : unique.filter((t) => declared.includes(t)).length / declared.length
  const toolBreadthOk = unique.filter((t) => declared.includes(t)).length >= minRequired
  const provenanceMentioned = PROVENANCE_RE.test(input.outputText)

  const warnings: string[] = []
  if (!toolBreadthOk) {
    warnings.push(
      `tool breadth below minimum (${unique.length}/${minRequired} unique market tools; missing: ${missingTools.join(', ') || 'n/a'})`
    )
  }
  if (!provenanceMentioned) {
    warnings.push('output does not mention provider/freshness (provenance heuristic)')
  }

  return {
    uniqueToolCount: unique.length,
    toolBreadth,
    toolBreadthOk,
    provenanceMentioned,
    missingTools,
    warnings,
  }
}
