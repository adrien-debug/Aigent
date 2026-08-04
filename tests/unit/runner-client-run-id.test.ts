/**
 * clientRunId idempotency — reservation before execution.
 *
 * Proves that when a caller supplies a `clientRunId` that already exists for the
 * copilot, the runner rejects the duplicate BEFORE calling the model. With a
 * fresh key, the runner reserves a `running` row first, then executes, and
 * finally PATCHes the outcome.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { pgrest, PgrestError } from '@/lib/agent-mission-control/postgrest'
import { routeCompletion } from '@/lib/agent-mission-control/model-router'

vi.mock('@/lib/agent-mission-control/model-router', () => ({ routeCompletion: vi.fn() }))
vi.mock('@/lib/agent-mission-control/postgrest', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent-mission-control/postgrest')>(
    '@/lib/agent-mission-control/postgrest'
  )
  return {
    pgrest: vi.fn(),
    PgrestError: actual.PgrestError,
  }
})

const { executeCopilotRun, DuplicateClientRunIdError } = await import('@/lib/agent-mission-control/runner')

const pgrestMock = vi.mocked(pgrest)
const routeCompletionMock = vi.mocked(routeCompletion)

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
    allowNonActiveVersion: true,
    tools: [],
    maxCostPerRunUsd: 0,
    ...overrides,
  }
}

beforeEach(() => {
  routeCompletionMock.mockReset()
  pgrestMock.mockReset()
})

describe('executeCopilotRun — clientRunId deduplication', () => {
  it('rejects a duplicate clientRunId without executing the model', async () => {
    pgrestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'POST' && path === 'agent_runs') {
        throw new PgrestError(409, 'POST', 'agent_runs', 'duplicate key value violates unique constraint')
      }
      if (method === 'GET' && path.startsWith('agent_runs?')) {
        return [{ id: 'existing-run-1' }]
      }
      return []
    })

    await expect(executeCopilotRun(baseArgs({ clientRunId: 'id-1' }))).rejects.toBeInstanceOf(
      DuplicateClientRunIdError
    )

    expect(routeCompletionMock).not.toHaveBeenCalled()

    const reservationCall = pgrestMock.mock.calls.find((c) => c[0] === 'POST' && c[1] === 'agent_runs')
    expect(reservationCall).toBeDefined()
    expect(reservationCall?.[2]).toMatchObject({
      client_run_id: 'id-1',
      status: 'running',
    })
  })

  it('reserves a running row, executes, then patches the outcome for a fresh key', async () => {
    routeCompletionMock.mockResolvedValue({
      text: 'done',
      toolCalls: [],
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0.01,
      latencyMs: 1,
      provider: 'openai',
      model: 'gpt-5.4',
      resolvedProvider: 'openai',
      resolvedModel: 'gpt-5.4',
      modelVerified: true,
      fallbackUsed: false,
      rawFinishReason: 'stop',
    })

    pgrestMock.mockResolvedValue([])

    const res = await executeCopilotRun(baseArgs({ clientRunId: 'fresh-id' }))

    expect(res.status).toBe('completed')
    expect(routeCompletionMock).toHaveBeenCalledTimes(1)

    const reservation = pgrestMock.mock.calls.find((c) => c[0] === 'POST' && c[1] === 'agent_runs')
    expect(reservation?.[2]).toMatchObject({
      client_run_id: 'fresh-id',
      status: 'running',
    })

    const patch = pgrestMock.mock.calls.find((c) => c[0] === 'PATCH' && c[1].startsWith('agent_runs?id=eq.'))
    expect(patch).toBeDefined()
    expect(patch?.[2]).toMatchObject({
      status: 'completed',
      output_summary: expect.stringContaining('done'),
    })
  })
})
