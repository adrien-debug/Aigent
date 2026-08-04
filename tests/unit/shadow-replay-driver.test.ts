import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
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
    costUsd: input === 'unknown-cost' ? null : 0,
    toolAttempts: [],
  }))
  const replayExecute = vi.fn(async () => ({
    ok: true,
    outputShape: 'same',
    score: null,
    toolsCalled: [],
    unsafeActions: 0,
    latencyMs: 5,
    costUsd: 0,
  }))
  const shadowTelemetry = vi.fn(async () => {})
  const replayTelemetry = vi.fn(async () => {})
  return {
    tables,
    shadowCleanup,
    replayCleanup,
    shadowExecute,
    replayExecute,
    shadowTelemetry,
    replayTelemetry,
  }
})

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  PgrestError: class PgrestError extends Error {
    status: number
    constructor(status: number) {
      super(`PostgREST ${status}`)
      this.status = status
    }
  },
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
  makeLiveShadowAgent: vi.fn(async () => ({
    runAgent: h.shadowExecute,
    cleanup: h.shadowCleanup,
  })),
}))

vi.mock('@/lib/agent-mission-control/replay-live', () => ({
  makeLiveReplayRunner: vi.fn(async () => ({
    run: h.replayExecute,
    cleanup: h.replayCleanup,
  })),
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

describe('real shadow/replay driver persistence', () => {
  beforeEach(() => {
    h.tables.shadow_experiments.length = 0
    h.tables.replay_comparisons.length = 0
    vi.clearAllMocks()
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

  it('resumes the same reserved shadow row after an infrastructure failure', async () => {
    const driver = createShadowReplayDriver()
    h.shadowExecute.mockRejectedValueOnce(new Error('agent server timeout'))

    await expect(
      driver.runShadow({ ...common, productionVersionId: 'reference' }),
    ).rejects.toThrow(/agent server timeout/)
    expect(h.tables.shadow_experiments[0].status).toBe('stopped')

    const resumed = await driver.runShadow({ ...common, productionVersionId: 'reference' })
    expect(resumed.evidenceId).toBe(h.tables.shadow_experiments[0].id)
    expect(h.tables.shadow_experiments).toHaveLength(1)
    expect(h.tables.shadow_experiments[0].status).toBe('completed')
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
      cost_usd: 0,
      execution_mode: 'live_langgraph',
      version_verified: false,
    })
    expect(h.replayTelemetry).toHaveBeenCalledTimes(2)
    expect(h.replayCleanup).toHaveBeenCalledTimes(2)
  })
})
