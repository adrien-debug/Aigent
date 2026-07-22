/**
 * Agent Mission Control — local vLLM endpoint registry (server only).
 *
 * Maps the router-facing model ids of the `local` provider onto Adrien's vLLM
 * park (OpenAI-compatible /v1 endpoints on GPU1/GPU2). Selection is explicitly
 * opt-in: a copilot must be seeded with `modelProvider: 'local'` AND one of the
 * `LOCAL_VLLM_MODEL_IDS` below — the default routing (openai/google) is never
 * silently redirected here.
 *
 * Fail-closed like the other providers: the shared API key (VLLM_LOCAL_API_KEY)
 * and the endpoint's URL env var must both be set, otherwise the endpoint is
 * unavailable and the router's existing fallback policy (model-fallbacks.ts)
 * applies. Nothing here holds a secret — keys/URLs live only in env.
 */
import 'server-only'

import type { LocalVllmModelId } from './model-catalog'

export interface LocalVllmEndpointSpec {
  /** Env var holding the OpenAI-compatible base URL (must end with /v1). */
  urlEnvVar: string
  /** Optional env var overriding the upstream model id (`model` field sent to vLLM). */
  modelEnvVar: string
  /**
   * Upstream model id served by vLLM (as reported by GET /v1/models).
   * Overridable via `modelEnvVar` when the server is redeployed under a new id.
   */
  defaultUpstreamModel: string
  /** Hard context-window bound (prompt + completion), in tokens. */
  contextTokens: number
  /** Human-readable location/purpose of the endpoint. */
  description: string
}

/**
 * The five local endpoints. Keys are the router-facing model ids callers pass
 * as `model` together with `modelProvider: 'local'` — typed against the
 * client-safe id list in model-catalog.ts, so a key added or removed on one
 * side without the other is a compile error, not a silent drift.
 */
export const LOCAL_VLLM_ENDPOINTS: Record<LocalVllmModelId, LocalVllmEndpointSpec> = {
  'local-reasoning-70b': {
    urlEnvVar: 'VLLM_GPU1_REASONING_URL',
    modelEnvVar: 'VLLM_GPU1_REASONING_MODEL',
    defaultUpstreamModel: 'casperhansen/deepseek-r1-distill-llama-70b-awq',
    contextTokens: 8192,
    description: 'GPU1 :8003 — DeepSeek R1 distill Llama 70B AWQ (reasoning)',
  },
  'local-llama-70b': {
    urlEnvVar: 'VLLM_GPU2_LLAMA_URL',
    modelEnvVar: 'VLLM_GPU2_LLAMA_MODEL',
    // vllm-hearst serves the raw HF snapshot path as its model id (probed via
    // GET /v1/models). It changes if the server is redeployed with a
    // --served-model-name — override with the env var above in that case.
    defaultUpstreamModel:
      '/root/.cache/huggingface/hub/models--casperhansen--llama-3.3-70b-instruct-awq/snapshots/64d255621f40b42adaf6d1f32a47e1d4534c0f14',
    contextTokens: 8192,
    description: 'GPU2 :8003 — Llama 3.3 70B Instruct AWQ (vllm-hearst)',
  },
  'local-qwen-32b': {
    urlEnvVar: 'VLLM_GPU1_QWEN32_URL',
    modelEnvVar: 'VLLM_GPU1_QWEN32_MODEL',
    defaultUpstreamModel: 'Qwen/Qwen2.5-Coder-32B-Instruct-AWQ',
    contextTokens: 16384,
    description: 'GPU1 :8000 — Qwen2.5 Coder 32B Instruct AWQ',
  },
  'local-qwen-7b': {
    urlEnvVar: 'VLLM_GPU1_QWEN7_URL',
    modelEnvVar: 'VLLM_GPU1_QWEN7_MODEL',
    defaultUpstreamModel: 'Qwen/Qwen2.5-Coder-7B-Instruct-AWQ',
    contextTokens: 8192,
    description: 'GPU1 :8001 — Qwen2.5 Coder 7B Instruct AWQ',
  },
}

/** Spec for a router-facing model id, or undefined for unknown ids — the `in`
 *  guard narrows the free-string lookup without weakening the typed registry. */
function specFor(model: string): LocalVllmEndpointSpec | undefined {
  return model in LOCAL_VLLM_ENDPOINTS ? LOCAL_VLLM_ENDPOINTS[model as LocalVllmModelId] : undefined
}

/** Fully resolved endpoint (env applied), ready for an OpenAI-compatible call. */
export interface ResolvedLocalVllmEndpoint {
  baseUrl: string
  apiKey: string
  upstreamModel: string
  contextTokens: number
}

function localApiKey(): string | undefined {
  return process.env.VLLM_LOCAL_API_KEY || undefined
}

/**
 * True if this local model id is known AND its endpoint is configured
 * (shared key + endpoint URL present). Mirrors openAiAvailable/geminiAvailable.
 */
export function localVllmAvailable(model: string): boolean {
  const spec = specFor(model)
  if (!spec) return false
  return Boolean(localApiKey() && process.env[spec.urlEnvVar])
}

/**
 * Resolve a router-facing local model id to its endpoint, or null when the
 * id is unknown or env is missing (caller turns that into a typed
 * ProviderUnavailableError so the fallback policy can apply).
 */
export function resolveLocalVllmEndpoint(model: string): ResolvedLocalVllmEndpoint | null {
  const spec = specFor(model)
  if (!spec) return null
  const apiKey = localApiKey()
  const baseUrl = process.env[spec.urlEnvVar]
  if (!apiKey || !baseUrl) return null
  return {
    baseUrl,
    apiKey,
    upstreamModel: process.env[spec.modelEnvVar] || spec.defaultUpstreamModel,
    contextTokens: spec.contextTokens,
  }
}
