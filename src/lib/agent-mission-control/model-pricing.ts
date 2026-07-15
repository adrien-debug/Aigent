/**
 * Agent Mission Control — model pricing (server only, but pure — safe anywhere).
 *
 * Per-1M-token USD cost, used to normalise run/benchmark costs across
 * providers. These are CONSERVATIVE ESTIMATES, not billing-grade truth: list
 * prices move and the exact seeded model ids may not map 1:1 to a public SKU.
 * Treat every number here as an approximation for ranking/telemetry, not an
 * invoice. Update when a provider's public pricing is confirmed.
 *
 * When a model id isn't in the table we fall back to a per-provider default
 * (also an estimate) so cost is never NaN and never silently zero.
 */
import 'server-only'

import type { ModelProvider } from './types'

interface ModelPricing {
  inputUsdPer1M: number
  outputUsdPer1M: number
  /** True when this row is a provider default, not a model-specific figure. */
  estimated?: boolean
}

// Model-specific estimates (USD per 1M tokens). CONSERVATIVE — see file header.
const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-5.4': { inputUsdPer1M: 1.25, outputUsdPer1M: 10 },
  'gpt-5.4-nano': { inputUsdPer1M: 0.1, outputUsdPer1M: 0.4 },
  'gpt-5.4-mini': { inputUsdPer1M: 0.4, outputUsdPer1M: 1.6 },
  'gpt-5.1': { inputUsdPer1M: 1.25, outputUsdPer1M: 10 },
  'gpt-4.1': { inputUsdPer1M: 2, outputUsdPer1M: 8 },
  'gpt-4o': { inputUsdPer1M: 2.5, outputUsdPer1M: 10 },
  'gpt-4o-mini': { inputUsdPer1M: 0.15, outputUsdPer1M: 0.6 },
  // Google
  'gemini-2.5-pro': { inputUsdPer1M: 1.25, outputUsdPer1M: 10 },
  'gemini-2.5-flash': { inputUsdPer1M: 0.3, outputUsdPer1M: 2.5 },
}

// Per-provider fallback estimates when a model id is unknown.
const PROVIDER_DEFAULT_PRICING: Record<ModelProvider, ModelPricing> = {
  openai: { inputUsdPer1M: 1.25, outputUsdPer1M: 10, estimated: true },
  google: { inputUsdPer1M: 1.25, outputUsdPer1M: 10, estimated: true },
  mistral: { inputUsdPer1M: 2, outputUsdPer1M: 6, estimated: true },
  local: { inputUsdPer1M: 0, outputUsdPer1M: 0, estimated: true },
}

/** Resolve pricing for a model id, falling back to the provider default. */
function pricingFor(provider: ModelProvider, model: string): ModelPricing {
  return MODEL_PRICING[model] ?? PROVIDER_DEFAULT_PRICING[provider]
}

/** Normalised USD cost. Never NaN — missing tokens count as 0. */
export function computeCostUsd(
  provider: ModelProvider,
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const p = pricingFor(provider, model)
  const inTok = Number.isFinite(inputTokens) ? inputTokens : 0
  const outTok = Number.isFinite(outputTokens) ? outputTokens : 0
  const cost = (inTok / 1e6) * p.inputUsdPer1M + (outTok / 1e6) * p.outputUsdPer1M
  return Math.round(cost * 1e6) / 1e6
}

/**
 * Deterministic token estimate for providers/paths that don't return usage.
 * ~4 chars/token is the standard rough heuristic. Never returns NaN.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}
