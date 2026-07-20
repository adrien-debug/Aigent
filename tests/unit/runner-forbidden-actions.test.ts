/**
 * Direct model-router path — manifest `forbiddenActions` enforced at runtime.
 *
 * Before this, `forbiddenActions` only existed as prose in the system prompt;
 * the sole executable rule lived in `benchmark-runner.ts`, i.e. after the run.
 * These tests drive `executeCopilotRun` with the router, the tool handlers and
 * PostgREST mocked, and assert the guardrail refuses a forbidden tool BEFORE
 * the handler runs, with the same word-boundary semantics as the benchmark.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const routeCompletion = vi.fn()
const pgrest = vi.fn()
const deleteCustomer = vi.fn()
const deleteCustomerNote = vi.fn()

vi.mock('@/lib/agent-mission-control/model-router', () => ({ routeCompletion }))
vi.mock('@/lib/agent-mission-control/postgrest', () => ({ pgrest }))
vi.mock('@/lib/agent-mission-control/tool-handlers', () => ({
  TOOL_HANDLERS: {
    delete_customer: deleteCustomer,
    delete_customer_note: deleteCustomerNote,
  },
}))

const { executeCopilotRun } = await import('@/lib/agent-mission-control/runner')

function tool(name: string) {
  return { id: `tool-${name}`, name, description: name, riskLevel: 'low' as const, requiresConfirmation: false }
}

/** A turn asking for `name`, then a final answer on the next turn. */
function turnCalling(name: string) {
  return {
    text: '',
    toolCalls: [{ id: 'tc-1', name, argumentsJson: '{}' }],
    inputTokens: 1,
    outputTokens: 1,
    costUsd: 0,
    latencyMs: 1,
    resolvedProvider: 'openai',
    resolvedModel: 'gpt-5.4',
    fallbackUsed: false,
    rawFinishReason: 'tool_calls',
  }
}

function finalTurn(text = 'done') {
  return { ...turnCalling(''), text, toolCalls: [], rawFinishReason: 'stop' }
}

/** PostgREST: the version points at a manifest declaring `forbidden`. */
function mockManifest(forbidden: string[] | null) {
  pgrest.mockImplementation(async (_method: string, path: string) => {
    if (path.startsWith('copilot_versions?')) return [{ manifest_id: 'm-1' }]
    if (path.startsWith('manifests?')) {
      return [{ tool_ids: [], max_cost_per_run_usd: null, forbidden_actions: forbidden }]
    }
    return []
  })
}

function baseArgs(overrides: Record<string, unknown> = {}) {
  return {
    copilotId: 'cp-1',
    versionId: 'v-1',
    projectId: 'p-1',
    model: 'gpt-5.4',
    systemPromptSummary: 'You are a copilot.',
    userInput: 'hello',
    maxSteps: 5,
    runtime: 'custom' as const,
    // No maxCostPerRunUsd → the runner reads the manifest (tools stay explicit).
    tools: [tool('delete_customer'), tool('delete_customer_note')],
    ...overrides,
  }
}

beforeEach(() => {
  routeCompletion.mockReset()
  pgrest.mockReset()
  deleteCustomer.mockReset()
  deleteCustomerNote.mockReset()
  deleteCustomer.mockResolvedValue({ ok: true, data: null, summary: 'deleted' })
  deleteCustomerNote.mockResolvedValue({ ok: true, data: null, summary: 'note deleted' })
})

describe('executeCopilotRun — manifest forbiddenActions', () => {
  it('blocks a forbidden tool even when granted by the manifest and needing no confirmation', async () => {
    mockManifest(['never call delete_customer'])
    routeCompletion.mockResolvedValueOnce(turnCalling('delete_customer')).mockResolvedValueOnce(finalTurn())

    const res = await executeCopilotRun(baseArgs())

    expect(deleteCustomer).not.toHaveBeenCalled()
    const blocked = res.steps.find((s) => s.title === 'Blocked · delete_customer')
    expect(blocked).toBeDefined()
    expect(blocked?.status).toBe('blocked')
    expect(blocked?.detail).toContain('forbiddenActions')
    expect(blocked?.detail).toContain('never call delete_customer')
  })

  it('respects word boundaries — delete_customer_note runs when only delete_customer is forbidden', async () => {
    mockManifest(['delete_customer'])
    routeCompletion.mockResolvedValueOnce(turnCalling('delete_customer_note')).mockResolvedValueOnce(finalTurn())

    const res = await executeCopilotRun(baseArgs())

    expect(deleteCustomerNote).toHaveBeenCalledTimes(1)
    expect(res.steps.some((s) => s.title.startsWith('Blocked ·'))).toBe(false)
  })

  it('changes nothing when forbiddenActions is empty or absent', async () => {
    mockManifest(null)
    routeCompletion.mockResolvedValueOnce(turnCalling('delete_customer')).mockResolvedValueOnce(finalTurn())

    const res = await executeCopilotRun(baseArgs())

    expect(deleteCustomer).toHaveBeenCalledTimes(1)
    expect(res.steps.some((s) => s.title.startsWith('Blocked ·'))).toBe(false)
  })

  it('records the block as a blocked tool_call and never executes the handler', async () => {
    mockManifest(['delete_customer'])
    routeCompletion.mockResolvedValueOnce(turnCalling('delete_customer')).mockResolvedValueOnce(finalTurn())

    await executeCopilotRun(baseArgs())

    expect(deleteCustomer).not.toHaveBeenCalled()
    const writes = pgrest.mock.calls.filter((c) => c[0] === 'POST')
    const serialized = JSON.stringify(writes)
    expect(serialized).toContain('"status":"blocked"')
    expect(serialized).toContain('forbiddenActions')
  })
})
