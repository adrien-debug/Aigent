/**
 * Direct model-router path — per-run USD ceiling + temporal anchoring.
 *
 * `max_cost_per_run_usd` used to be a placebo (persisted, loaded, never
 * compared). These tests drive `executeCopilotRun` with the model router and
 * PostgREST mocked, and assert the run stops fail-closed once the accumulated
 * cost crosses the manifest ceiling — and is untouched when no ceiling exists.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelRouterMessage } from '@/lib/agent-mission-control/model-router'

const routeCompletion = vi.fn()
const pgrest = vi.fn()

vi.mock('@/lib/agent-mission-control/model-router', () => ({ routeCompletion }))
vi.mock('@/lib/agent-mission-control/postgrest', () => ({ pgrest }))

const { executeCopilotRun } = await import('@/lib/agent-mission-control/runner')

/** One model turn costing `costUsd`, never producing a final answer. */
function turnCosting(costUsd: number, text = '') {
  return {
    text,
    toolCalls: [],
    inputTokens: 10,
    outputTokens: 10,
    costUsd,
    latencyMs: 1,
    resolvedProvider: 'openai',
    resolvedModel: 'gpt-5.4',
    fallbackUsed: false,
    rawFinishReason: 'stop',
  }
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
    // Runner MECHANICS test on a candidate — skip the lifecycle "still serving"
    // guard (AIGENT-RUNTIME-PROMOTION-001, Phase 5).
    allowNonActiveVersion: true,
    tools: [],
    ...overrides,
  }
}

beforeEach(() => {
  routeCompletion.mockReset()
  pgrest.mockReset()
  // Every persistence write succeeds; no read is needed (tools + ceiling are
  // passed explicitly in these tests, except where noted).
  pgrest.mockResolvedValue([])
})

describe('executeCopilotRun — cost ceiling', () => {
  it('stops fail-closed once the accumulated cost crosses the ceiling', async () => {
    // Each turn costs 0.4; the ceiling is 0.5. Turn 1 runs (cost 0 < 0.5),
    // turn 2 runs (0.4 < 0.5), turn 3 must NOT happen (0.8 >= 0.5).
    // The turn requests a tool (denied — the copilot has none), so the loop
    // keeps going instead of treating the empty text as a final answer.
    routeCompletion.mockResolvedValue({
      ...turnCosting(0.4),
      toolCalls: [{ id: 'tc-1', name: 'unknown_tool', argumentsJson: '{}' }],
    })

    const res = await executeCopilotRun(baseArgs({ maxCostPerRunUsd: 0.5, maxSteps: 10 }))

    expect(routeCompletion).toHaveBeenCalledTimes(2)
    expect(res.status).toBe('failed')
    expect(res.outputSummary).toContain('Cost ceiling reached')
    expect(res.steps.some((s) => s.title === 'Cost ceiling reached')).toBe(true)
  })

  it('does not stop a run that stays under the ceiling', async () => {
    routeCompletion.mockResolvedValue(turnCosting(0.01, 'done'))

    const res = await executeCopilotRun(baseArgs({ maxCostPerRunUsd: 5 }))

    expect(res.status).toBe('completed')
    expect(res.outputSummary).toContain('done')
  })

  it('is unbounded when no ceiling is defined (manifest returns none)', async () => {
    // No explicit maxCostPerRunUsd → the runner reads the manifest; the mocked
    // PostgREST returns no rows, i.e. no ceiling.
    routeCompletion.mockResolvedValue(turnCosting(9_999, 'expensive but allowed'))

    const res = await executeCopilotRun(baseArgs({ maxCostPerRunUsd: undefined }))

    expect(res.status).toBe('completed')
    expect(routeCompletion).toHaveBeenCalledTimes(1)
  })

  it('treats a zero/negative manifest ceiling as unbounded, not as instant failure', async () => {
    routeCompletion.mockResolvedValue(turnCosting(0.02, 'ok'))

    const res = await executeCopilotRun(baseArgs({ maxCostPerRunUsd: 0 }))

    expect(res.status).toBe('completed')
    expect(routeCompletion).toHaveBeenCalledTimes(1)
  })
})

describe('executeCopilotRun — temporal anchoring', () => {
  it('prepends the temporal block to the system prompt exactly once', async () => {
    routeCompletion.mockResolvedValue(turnCosting(0.01, 'done'))

    await executeCopilotRun(baseArgs())

    const call = routeCompletion.mock.calls[0][0] as { messages: ModelRouterMessage[] }
    const system = call.messages[0]
    expect(system.role).toBe('system')
    expect(system.content).toContain('## Temporal context')
    expect(system.content.split('## Temporal context')).toHaveLength(2)
    expect(system.content).toContain('You are a copilot.')
  })
})
