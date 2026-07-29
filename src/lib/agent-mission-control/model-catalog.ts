/**
 * Agent Mission Control — model catalog (client-safe).
 *
 * Pure data shared by client forms and server modules: the router-facing
 * local-provider model ids. NO 'server-only', no env reads, no secrets —
 * endpoint specs (URLs, env var names, context windows) stay in
 * `model-local.ts`, which is server-only and types its registry against
 * `LOCAL_VLLM_MODEL_IDS` below so the two cannot drift.
 */

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
] as const
export type LocalVllmModelId = (typeof LOCAL_VLLM_MODEL_IDS)[number]
