/**
 * Unit tests for recursionLimitFor (src/lib/agent-mission-control/langgraph-server.ts).
 *
 * recursionLimitFor is NOT exported (internal helper) and langgraph-server.ts
 * is `server-only` + builds a real SDK Client at call time — so this module
 * cannot be imported at all without (a) the `react-server` resolve condition
 * (see vitest.config.ts, mirroring the repo's existing
 * `tsx --conditions=react-server` pattern) and (b) a mock of
 * `@langchain/langgraph-sdk`'s `Client`, so no real network call happens.
 *
 * The formula under test (from the source comments):
 *   derived = max(1, floor(maxSteps)) * 3 + 3 + 1    (NODES_PER_STEP = 3; the
 *             extra +3 is headroom for the budget-guard's tool-free CLOSING turn)
 *   result  = clamp(derived, 25 /* SDK default floor *\/, 150 /* cap *\/)
 *   undefined maxSteps (or non-finite) -> undefined (caller keeps SDK default)
 *
 * We assert on it BLACK-BOX, through its only observable effect: the
 * `config.recursion_limit` argument passed to the mocked `runs.wait`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const waitMock = vi.fn()
const createThreadMock = vi.fn()
const getStateMock = vi.fn()

vi.mock('@langchain/langgraph-sdk', () => {
  class FakeClient {
    threads = { create: createThreadMock, getState: getStateMock }
    runs = { wait: waitMock }
  }
  return { Client: FakeClient }
})

describe('recursionLimitFor (via runOnAgentServer -> runs.wait config.recursion_limit)', () => {
  beforeEach(() => {
    vi.resetModules()
    createThreadMock.mockReset().mockResolvedValue({ thread_id: 'thread-1' })
    getStateMock.mockReset().mockResolvedValue({ tasks: [] })
    waitMock.mockReset().mockResolvedValue({ messages: [{ type: 'ai', content: 'done' }] })
    process.env.LANGGRAPH_API_URL = 'http://127.0.0.1:2024'
    process.env.LANGGRAPH_SERVER_SECRET = 'test-secret'
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  async function runWith(maxSteps: number | undefined) {
    const { runOnAgentServer } = await import('@/lib/agent-mission-control/langgraph-server')
    await runOnAgentServer({ userInput: 'hi', maxSteps })
    const callArgs = waitMock.mock.calls.at(-1)
    return (callArgs?.[2] as { config?: { recursion_limit?: number } } | undefined)?.config?.recursion_limit
  }

  it('never goes under the SDK default floor (25), even for a tiny maxSteps', async () => {
    const limit = await runWith(1)
    // derived = 1*3+3+1 = 7, floored at 25.
    expect(limit).toBe(25)
  })

  it('leaves headroom for the closing turn at maxSteps=8 (Security Sentinel)', async () => {
    // derived = 8*3+3+1 = 28 -> above the SDK floor of 25, so the budget-guard's
    // tool-free closing turn fits before the recursion limit. Previously this
    // was 8*3+1 = 25 (== floor), leaving zero room -> GraphRecursionError.
    const limit = await runWith(8)
    expect(limit).toBe(28)
  })

  it('is proportional to maxSteps within the floor/cap band', async () => {
    // derived = 10*3+3+1 = 34 -> within [25,150], so exactly 34.
    const limit = await runWith(10)
    expect(limit).toBe(34)
  })

  it('is capped at 150 for a very large maxSteps', async () => {
    // derived = 1000*3+3+1 = 3004, capped at 150.
    const limit = await runWith(1000)
    expect(limit).toBe(150)
  })

  it('omits recursion_limit (keeps SDK default) when maxSteps is undefined', async () => {
    const limit = await runWith(undefined)
    expect(limit).toBeUndefined()
  })

  it('omits recursion_limit when maxSteps is NaN (non-finite)', async () => {
    const limit = await runWith(Number.NaN)
    expect(limit).toBeUndefined()
  })

  it('floors a fractional maxSteps before deriving the limit', async () => {
    // floor(10.9) = 10 -> derived = 10*3+3+1 = 34.
    const limit = await runWith(10.9)
    expect(limit).toBe(34)
  })
})
