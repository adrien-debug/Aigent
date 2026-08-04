import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  class MockPgrestError extends Error {
    status: number
    constructor(status: number) {
      super(`PostgREST ${status}`)
      this.status = status
    }
  }
  const tables: Record<string, Array<Record<string, unknown>>> = {
    shadow_experiments: [],
    replay_comparisons: [],
  }
  const shadowCleanup = vi.fn(async () => {})
  const replayCleanup = vi.fn(async () => {})
  const shadowExecute = vi.fn(async (input: unknown) => ({
    ok: true,
    output: input,
    error: null,
    latencyMs: 5,
    costUsd: input === 'unknown-cost' ? null : 0.25,
    toolAttempts: [],
  }))
  const replayExecute = vi.fn(async () => ({
    ok: true,
    outputShape: 'same',
    score: null,
    toolsCalled: [],
    unsafeActions: 0,
    latencyMs: 5,
    costUsd: 0.25,
  }))
  const shadowFactory = vi.fn(async () => ({
    runAgent: shadowExecute,
    cleanup: shadowCleanup,
  }))
  const replayFactory = vi.fn(async () => ({
    run: replayExecute,
    cleanup: replayCleanup,
  }))
  const shadowTelemetry = vi.fn(async (_args: { eventType: string }) => {})
  const replayTelemetry = vi.fn(async (_args: { eventType: string }) => {})
  return {
    MockPgrestError,
    tables,
    shadowCleanup,
    replayCleanup,
    shadowExecute,
    replayExecute,
    shadowFactory,
    replayFactory,
    shadowTelemetry,
    replayTelemetry,
  }
})

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  PgrestError: h.MockPgrestError,
  pgrest: async (method: string, path: string, body?: Record<string, unknown>) => {
    const [table, query = ''] = path.split('?')
    const rows = (h.tables[table] ??= [])
    const filters = Object.fromEntries(
      query
        .split('&')
        .filter((item) => item.includes('=eq.'))
        .map((item) => {
          const [key, value] = item.split('=eq.')
          return [key, decodeURIComponent(value)]
        }),
    )
    const matching = rows.filter((row) =>
      Object.entries(filters).every(([key, value]) => String(row[key]) === value),
    )
    if (method === 'GET') return matching
    if (method === 'POST') {
      const duplicate = rows.some(
        (row) =>
          body?.idempotency_key != null &&
          row.idempotency_key === body.idempotency_key &&
          row.copilot_id === body.copilot_id,
      )
      if (duplicate) {
        throw new h.MockPgrestError(409)
      }
      rows.push({ ...body })
      return [{ ...body }]
    }
    if (method === 'PATCH') {
      for (const row of matching) Object.assign(row, body)
      return matching
    }
    return []
  },
}))

vi.mock('@/lib/agent-mission-control/shadow-live', () => ({
  loadCandidateExec: vi.fn(async (versionId: string) => ({
    copilotId: 'copilot-a',
    projectId: 'tenant-a',
    model: versionId === 'reference' ? 'gpt-reference' : 'gpt-candidate',
    modelProvider: 'openai',
    systemPromptSummary: 'safe',
    maxSteps: 4,
  })),
  makeLiveShadowAgent: h.shadowFactory,
}))

vi.mock('@/lib/agent-mission-control/replay-live', () => ({
  makeLiveReplayRunner: h.replayFactory,
}))

vi.mock('@/lib/agent-mission-control/runtime-telemetry-store', () => ({
  emitShadowTelemetry: h.shadowTelemetry,
  emitReplayTelemetry: h.replayTelemetry,
}))

vi.mock('@/lib/agent-mission-control/shadow-replay-routes-shared', () => ({
  readVersionStage: vi.fn(async () => 'draft'),
}))

import { createShadowReplayDriver } from '@/lib/agent-mission-control/shadow-replay-driver'

const common = {
  copilotId: 'copilot-a',
  candidateVersionId: 'candidate',
  qualificationRunId: 'qual-a',
  sourceRunId: 'run-a',
  contentHash: 'a'.repeat(64),
  inputs: ['known-cost', 'unknown-cost'],
}

function resetExecutors(): void {
  h.shadowExecute.mockReset().mockImplementation(async (input: unknown) => ({
    ok: true,
    output: input,
    error: null,
    latencyMs: 5,
    costUsd: input === 'unknown-cost' ? null : 0.25,
    toolAttempts: [],
  }))
  h.replayExecute.mockReset().mockImplementation(async () => ({
    ok: true,
    outputShape: 'same',
    score: null,
    toolsCalled: [],
    unsafeActions: 0,
    latencyMs: 5,
    costUsd: 0.25,
  }))
}

function releaseGate(): { wait: Promise<void>; release: () => void } {
  let release = () => {}
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  return { wait, release }
}

function expectCoherentResults(
  settled: PromiseSettledResult<{ evidenceId: string; verdict: string }>[],
  expected: { evidenceId: string; verdict: string },
): void {
  expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(settled.length - 1)
  for (const result of settled) {
    if (result.status === 'fulfilled') expect(result.value).toEqual(expected)
    else expect(result.reason).toMatchObject({ message: expect.stringMatching(/already running/) })
  }
}

function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  return promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }),
  )
}

describe('real shadow/replay driver persistence', () => {
  beforeEach(() => {
    h.tables.shadow_experiments.length = 0
    h.tables.replay_comparisons.length = 0
    vi.clearAllMocks()
    resetExecutors()
  })

  it('persists shadow before telemetry and preserves an unknown partial cost', async () => {
    const driver = createShadowReplayDriver()
    const result = await driver.runShadow({ ...common, productionVersionId: 'reference' })
    const row = h.tables.shadow_experiments[0]

    expect(result.evidenceId).toBe(row.id)
    expect(row).toMatchObject({
      status: 'completed',
      candidate_verdict: 'PASS',
      qualification_run_id: 'qual-a',
      source_run_id: 'run-a',
      content_hash: common.contentHash,
      provider: 'openai',
      model: 'gpt-candidate',
      cost_usd: null,
      execution_mode: 'live_langgraph',
      version_verified: false,
    })
    expect(h.shadowTelemetry).toHaveBeenCalledTimes(2)
    expect(h.shadowCleanup).toHaveBeenCalledOnce()
  })

  it('collapses a repeated shadow idempotency key without executing twice', async () => {
    const driver = createShadowReplayDriver()
    const first = await driver.runShadow({ ...common, productionVersionId: 'reference' })
    const executions = h.shadowExecute.mock.calls.length
    const second = await driver.runShadow({ ...common, productionVersionId: 'reference' })

    expect(second).toEqual(first)
    expect(h.tables.shadow_experiments).toHaveLength(1)
    expect(h.shadowExecute).toHaveBeenCalledTimes(executions)
  })

  it('makes a failed shadow terminal and never retries it silently', async () => {
    const driver = createShadowReplayDriver()
    h.shadowExecute.mockRejectedValueOnce(new Error('agent server timeout'))

    await expect(
      driver.runShadow({ ...common, productionVersionId: 'reference' }),
    ).rejects.toThrow(/agent server timeout/)
    expect(h.tables.shadow_experiments[0].status).toBe('failed')

    await expect(
      driver.runShadow({ ...common, productionVersionId: 'reference' }),
    ).rejects.toThrow(/failed; automatic retry is disabled/)
    expect(h.tables.shadow_experiments).toHaveLength(1)
    expect(h.shadowFactory).toHaveBeenCalledOnce()
  })

  it('persists replay on the same corpus and reuses the reserved row', async () => {
    const driver = createShadowReplayDriver()
    const result = await driver.runReplay({ ...common, referenceVersionId: 'reference' })
    const row = h.tables.replay_comparisons[0]

    expect(result.evidenceId).toBe(row.id)
    expect(row).toMatchObject({
      status: 'matched',
      verdict: 'EQUIVALENT',
      qualification_run_id: 'qual-a',
      content_hash: common.contentHash,
      provider: 'openai',
      model: 'gpt-candidate',
      cost_usd: 1,
      execution_mode: 'live_langgraph',
      version_verified: false,
    })
    expect(h.replayTelemetry).toHaveBeenCalledTimes(2)
    expect(h.replayCleanup).toHaveBeenCalledTimes(2)
  })

  it('makes a failed replay terminal and never retries it silently', async () => {
    const driver = createShadowReplayDriver()
    h.replayExecute.mockRejectedValueOnce(new Error('agent server timeout'))

    await expect(
      driver.runReplay({ ...common, referenceVersionId: 'reference' }),
    ).rejects.toThrow(/agent server timeout/)
    expect(h.tables.replay_comparisons[0].status).toBe('failed')

    await expect(
      driver.runReplay({ ...common, referenceVersionId: 'reference' }),
    ).rejects.toThrow(/failed; automatic retry is disabled/)
    expect(h.tables.replay_comparisons).toHaveLength(1)
    expect(h.replayFactory).toHaveBeenCalledTimes(2)
  })

  it.each([2, 10])(
    'atomically collapses %i simultaneous shadow calls into one billed execution',
    async (concurrency) => {
      const driver = createShadowReplayDriver()
      const gate = releaseGate()
      h.shadowExecute.mockImplementation(async (input: unknown) => {
        await gate.wait
        return {
          ok: true,
          output: input,
          error: null,
          latencyMs: 5,
          costUsd: 0.25,
          toolAttempts: [],
        }
      })

      let settledBeforeRelease = 0
      const calls = Array.from({ length: concurrency }, () => {
        const call = driver.runShadow({ ...common, inputs: ['billable'], productionVersionId: 'reference' })
        return settle(call).then((result) => {
          settledBeforeRelease += 1
          return result
        })
      })
      await vi.waitFor(() => expect(h.shadowFactory).toHaveBeenCalledOnce())
      await vi.waitFor(() => expect(settledBeforeRelease).toBe(concurrency - 1))
      gate.release()
      const settled = await Promise.all(calls)
      const row = h.tables.shadow_experiments[0]
      const expected = { evidenceId: row.id as string, verdict: 'PASS' }

      expectCoherentResults(settled, expected)
      expect(h.tables.shadow_experiments).toHaveLength(1)
      expect(row).toMatchObject({ status: 'completed', cost_usd: 0.25 })
      expect(h.shadowFactory).toHaveBeenCalledOnce()
      expect(h.shadowExecute).toHaveBeenCalledOnce()
      expect(
        h.shadowTelemetry.mock.calls.filter(([args]) => args.eventType === 'shadow_completed'),
      ).toHaveLength(1)
    },
  )

  it.each([2, 10])(
    'atomically collapses %i simultaneous replay calls into one billed execution',
    async (concurrency) => {
      const driver = createShadowReplayDriver()
      const gate = releaseGate()
      h.replayExecute.mockImplementation(async () => {
        await gate.wait
        return {
          ok: true,
          outputShape: 'same',
          score: null,
          toolsCalled: [],
          unsafeActions: 0,
          latencyMs: 5,
          costUsd: 0.25,
        }
      })

      let settledBeforeRelease = 0
      const calls = Array.from({ length: concurrency }, () => {
        const call = driver.runReplay({ ...common, inputs: ['billable'], referenceVersionId: 'reference' })
        return settle(call).then((result) => {
          settledBeforeRelease += 1
          return result
        })
      })
      await vi.waitFor(() => expect(h.replayFactory).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => expect(settledBeforeRelease).toBe(concurrency - 1))
      gate.release()
      const settled = await Promise.all(calls)
      const row = h.tables.replay_comparisons[0]
      const expected = { evidenceId: row.id as string, verdict: 'EQUIVALENT' }

      expectCoherentResults(settled, expected)
      expect(h.tables.replay_comparisons).toHaveLength(1)
      expect(row).toMatchObject({ status: 'matched', cost_usd: 0.5 })
      expect(h.replayFactory).toHaveBeenCalledTimes(2)
      expect(h.replayExecute).toHaveBeenCalledTimes(2)
      expect(
        h.replayTelemetry.mock.calls.filter(([args]) => args.eventType === 'replay_completed'),
      ).toHaveLength(1)
    },
  )
})
