/**
 * Agent Mission Control — model fallback policy (server only).
 *
 * When a copilot's seeded provider/model is unavailable (SDK/env missing,
 * model access denied), the router may fall back to a cheap OpenAI model so a
 * stale seed model doesn't break every run. The policy is deliberately narrow:
 *
 *   - JUDGE calls always fall back to the OpenAI judge model when available
 *     (grading must not depend on the copilot's exact model, and a judge is
 *     provider-agnostic by design).
 *   - RUN / BENCHMARK calls fall back ONLY when explicitly allowed — either the
 *     env flag AMC_ALLOW_MODEL_FALLBACKS=1, or a per-request opt-in passed by
 *     the runner (route body). Otherwise the router fails closed.
 *
 * A fallback is always marked (`fallbackUsed: true` + reason) so a run never
 * claims to have used the original model.
 *
 * Does NOT modify env files — it only reads env.
 */
import 'server-only'

import type { ModelProvider } from './types'

const OPENAI_JUDGE_FALLBACK_MODEL = 'gpt-5.4-nano'
const OPENAI_RUN_FALLBACK_MODEL = 'gpt-5.4-nano'

export type RouterPurpose = 'run' | 'judge' | 'architect' | 'benchmark'

/** True if run/benchmark fallbacks are enabled by env. */
function fallbacksAllowedByEnv(): boolean {
  return process.env.AMC_ALLOW_MODEL_FALLBACKS === '1'
}

export interface FallbackDecision {
  provider: ModelProvider
  model: string
  reason: string
}

/**
 * Decide the fallback for a failed primary call, or null if none is permitted.
 *
 * @param purpose        why we were calling the model
 * @param originalReason human-readable reason the primary failed
 * @param requestOptIn   per-request fallback opt-in (route body), OR-ed with env
 * @param openAiAvailable whether OPENAI_API_KEY is set (the only fallback target)
 */
export function resolveFallback(args: {
  purpose: RouterPurpose
  originalReason: string
  requestOptIn?: boolean
  openAiAvailable: boolean
}): FallbackDecision | null {
  const { purpose, originalReason, requestOptIn, openAiAvailable } = args
  if (!openAiAvailable) return null // the only fallback target is OpenAI

  if (purpose === 'judge') {
    return {
      provider: 'openai',
      model: OPENAI_JUDGE_FALLBACK_MODEL,
      reason: `judge fallback → openai/${OPENAI_JUDGE_FALLBACK_MODEL} (${originalReason})`,
    }
  }

  // run / benchmark / architect: gated.
  if (requestOptIn === true || fallbacksAllowedByEnv()) {
    return {
      provider: 'openai',
      model: OPENAI_RUN_FALLBACK_MODEL,
      reason: `run fallback → openai/${OPENAI_RUN_FALLBACK_MODEL} (${originalReason})`,
    }
  }
  return null
}
