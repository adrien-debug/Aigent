/**
 * LangGraph model factory — multi-provider chat model for agent_builder.
 *
 * Mirrors the direct-path model-router providers (openai / google / local).
 * `mistral` is declared but not wired — throws like model-router.ts.
 *
 * Google uses Gemini's OpenAI-compatible REST surface so tool binding works
 * through the same ChatOpenAI + bindTools path as OpenAI/local vLLM.
 */
import { ChatOpenAI } from '@langchain/openai'

const DEFAULT_PROVIDER = 'openai'
const GEMINI_OPENAI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai/'

/** Mirror of src/lib/agent-mission-control/model-local.ts — keep env vars in sync. */
const LOCAL_VLLM_ENDPOINTS = {
  'local-reasoning-70b': {
    urlEnvVar: 'VLLM_GPU1_REASONING_URL',
    modelEnvVar: 'VLLM_GPU1_REASONING_MODEL',
    defaultUpstreamModel: 'casperhansen/deepseek-r1-distill-llama-70b-awq',
  },
  'local-llama-70b': {
    urlEnvVar: 'VLLM_GPU2_LLAMA_URL',
    modelEnvVar: 'VLLM_GPU2_LLAMA_MODEL',
    defaultUpstreamModel:
      '/root/.cache/huggingface/hub/models--casperhansen--llama-3.3-70b-instruct-awq/snapshots/64d255621f40b42adaf6d1f32a47e1d4534c0f14',
  },
  'local-qwen-32b': {
    urlEnvVar: 'VLLM_GPU1_QWEN32_URL',
    modelEnvVar: 'VLLM_GPU1_QWEN32_MODEL',
    defaultUpstreamModel: 'Qwen/Qwen2.5-Coder-32B-Instruct-AWQ',
  },
  'local-qwen-7b': {
    urlEnvVar: 'VLLM_GPU1_QWEN7_URL',
    modelEnvVar: 'VLLM_GPU1_QWEN7_MODEL',
    defaultUpstreamModel: 'Qwen/Qwen2.5-Coder-7B-Instruct-AWQ',
  },
  'local-finance-32b': {
    urlEnvVar: 'VLLM_GPU1_FINANCE_URL',
    modelEnvVar: 'VLLM_GPU1_FINANCE_MODEL',
    defaultUpstreamModel: 'qwen3-32b-finance',
  },
}

function resolveLocalEndpoint(modelId) {
  const spec = LOCAL_VLLM_ENDPOINTS[modelId]
  if (!spec) return null
  const apiKey = process.env.VLLM_LOCAL_API_KEY
  const baseUrl = process.env[spec.urlEnvVar]
  if (!apiKey || !baseUrl) return null
  const upstreamModel = process.env[spec.modelEnvVar] || spec.defaultUpstreamModel
  return { apiKey, baseUrl, upstreamModel }
}

/**
 * @param {{ model: string, modelProvider?: string }} opts
 * @returns {import('@langchain/openai').ChatOpenAI}
 */
export function createChatModel({ model, modelProvider = DEFAULT_PROVIDER }) {
  const provider = typeof modelProvider === 'string' && modelProvider.trim() ? modelProvider.trim() : DEFAULT_PROVIDER

  switch (provider) {
    case 'openai':
      return new ChatOpenAI({ model })

    case 'google': {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
      if (!apiKey) {
        throw new Error("provider 'google' not configured (GEMINI_API_KEY missing)")
      }
      return new ChatOpenAI({
        model,
        apiKey,
        configuration: { baseURL: GEMINI_OPENAI_BASE },
      })
    }

    case 'local': {
      const endpoint = resolveLocalEndpoint(model)
      if (!endpoint) {
        throw new Error(`local/${model}: endpoint not configured (VLLM_LOCAL_API_KEY or URL env missing)`)
      }
      return new ChatOpenAI({
        model: endpoint.upstreamModel,
        apiKey: endpoint.apiKey,
        configuration: { baseURL: endpoint.baseUrl },
      })
    }

    case 'mistral':
      throw new Error("provider 'mistral' is not wired in V1")

    default:
      throw new Error(`unknown provider '${provider}'`)
  }
}
