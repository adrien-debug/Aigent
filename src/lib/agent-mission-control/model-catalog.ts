/**
 * Agent Mission Control — model catalog (client-safe).
 *
 * Pure data shared by client forms (create-agent, run-benchmark) and server
 * modules: which model ids to suggest per creatable provider. NO 'server-only',
 * no env reads, no secrets — endpoint specs (URLs, env var names, context
 * windows) stay in `model-local.ts`, which is server-only and types its
 * registry against `LOCAL_VLLM_MODEL_IDS` below so the two cannot drift.
 */
import type { CreatableModelProvider } from './resource-ids'

/**
 * Router-facing model ids of the `local` provider (Adrien's vLLM park on
 * GPU1/GPU2). Callers pass one of these as `model` with
 * `modelProvider: 'local'` — selection is explicitly opt-in, never a silent
 * redirect of openai/google defaults.
 */
export const LOCAL_VLLM_MODEL_IDS = [
  'local-reasoning-70b',
  'local-llama-70b',
  'local-qwen-32b',
  'local-qwen-7b',
  'local-finance-32b',
] as const
export type LocalVllmModelId = (typeof LOCAL_VLLM_MODEL_IDS)[number]

/**
 * Suggested model ids per creatable provider — feeds the datalists in the
 * create-agent form and the per-run benchmark override. Suggestions, not an
 * allowlist: the backend validates what actually runs.
 */
export const SUGGESTED_MODELS: Record<CreatableModelProvider, readonly string[]> = {
  openai: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-4.1'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  local: LOCAL_VLLM_MODEL_IDS,
}
