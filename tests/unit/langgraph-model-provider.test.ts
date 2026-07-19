/**
 * Unit tests for createChatModel (src/langgraph/model-provider.mjs).
 *
 * Proves the LangGraph path routes openai / google / local / mistral the same
 * way as the direct model-router — without hitting real providers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const chatOpenAiMock = vi.fn(function ChatOpenAI(this: unknown, opts: Record<string, unknown>) {
  Object.assign(this as object, { opts, bindTools: vi.fn(() => ({ opts, bound: true })) })
  return this
})

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: chatOpenAiMock,
}))

describe('createChatModel', () => {
  beforeEach(() => {
    chatOpenAiMock.mockClear()
    delete process.env.GEMINI_API_KEY
    delete process.env.GOOGLE_API_KEY
    delete process.env.VLLM_LOCAL_API_KEY
    delete process.env.VLLM_GPU1_QWEN7_URL
  })

  it('defaults to openai', async () => {
    const { createChatModel } = await import('@/langgraph/model-provider.mjs')
    createChatModel({ model: 'gpt-5.4' })
    expect(chatOpenAiMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5.4' }))
  })

  it('routes google through the Gemini OpenAI-compatible base URL', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini'
    const { createChatModel } = await import('@/langgraph/model-provider.mjs')
    createChatModel({ model: 'gemini-2.5-flash', modelProvider: 'google' })
    expect(chatOpenAiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.5-flash',
        apiKey: 'test-gemini',
        configuration: { baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
      })
    )
  })

  it('routes local vLLM through the endpoint env vars', async () => {
    process.env.VLLM_LOCAL_API_KEY = 'local-key'
    process.env.VLLM_GPU1_QWEN7_URL = 'http://gpu1:8001/v1'
    const { createChatModel } = await import('@/langgraph/model-provider.mjs')
    createChatModel({ model: 'local-qwen-7b', modelProvider: 'local' })
    expect(chatOpenAiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'Qwen/Qwen2.5-Coder-7B-Instruct-AWQ',
        apiKey: 'local-key',
        configuration: { baseURL: 'http://gpu1:8001/v1' },
      })
    )
  })

  it('throws for mistral (not wired)', async () => {
    const { createChatModel } = await import('@/langgraph/model-provider.mjs')
    expect(() => createChatModel({ model: 'mistral-large', modelProvider: 'mistral' })).toThrow(/not wired/)
  })
})
