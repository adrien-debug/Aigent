/**
 * Route tests for POST /api/agent-ops/copilots/:copilotId/benchmarks/sweep
 * (src/app/api/agent-ops/copilots/[copilotId]/benchmarks/sweep/route.ts).
 *
 * `runBenchmarkSweep` is mocked at the module boundary — NO real benchmark
 * suite or LLM call is executed here. `pgrest` is mocked too (only used by
 * the route to read the copilot's runtime before calling the sweep).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BenchmarkSweepResult } from '@/lib/agent-mission-control/benchmark-sweep'

const COPILOT_ID = 'copilot-sweep-test'

const runBenchmarkSweepMock = vi.fn()
vi.mock('@/lib/agent-mission-control/benchmark-sweep', () => ({
  runBenchmarkSweep: (...args: unknown[]) => runBenchmarkSweepMock(...args),
}))

let pgrestImpl: (method: string, path: string) => Promise<unknown>
vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: (method: string, path: string) => pgrestImpl(method, path),
  isPgrestTimeout: (err: unknown) => err instanceof Error && err.message === 'TIMEOUT',
}))

import { POST } from '@/app/api/agent-ops/copilots/[copilotId]/benchmarks/sweep/route'

function req(body: unknown): Request {
  return new Request('http://test/sweep', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = Promise.resolve({ copilotId: COPILOT_ID })

function fakeSweepResult(): BenchmarkSweepResult {
  return {
    copilotId: COPILOT_ID,
    suiteId: 'suite-1',
    runtime: 'custom',
    legs: [
      {
        status: 'ran',
        model: 'local-qwen-7b',
        modelProvider: 'local',
        sweepScope: 'agent',
        run: {
          id: 'run-1',
          suiteId: 'suite-1',
          copilotId: COPILOT_ID,
          versionId: 'ver-1',
          model: 'local-qwen-7b',
          modelProvider: 'local',
          runtime: 'custom',
          startedAt: '2026-07-20T00:00:00.000Z',
          finishedAt: '2026-07-20T00:01:00.000Z',
          status: 'completed',
          resultId: 'res-1',
        },
        score: 82,
        contextTokens: 8192,
      },
      {
        status: 'skipped',
        model: 'gemini-x',
        modelProvider: 'google',
        skipReason: 'provider-unavailable',
        detail: 'provider `google` is not configured for model `gemini-x` — skipped, not substituted.',
        contextTokens: null,
      },
    ],
    ranCount: 1,
    skippedCount: 1,
    failedCount: 0,
    best: { model: 'local-qwen-7b', modelProvider: 'local', score: 82 },
    comparesAgents: true,
  }
}

describe('POST benchmarks/sweep', () => {
  const saved = {
    src: process.env.AMC_DATA_SOURCE,
    url: process.env.AMC_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    openai: process.env.OPENAI_API_KEY,
  }

  beforeEach(() => {
    process.env.AMC_DATA_SOURCE = 'gpu1'
    process.env.AMC_SUPABASE_URL = 'http://backend.test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
    process.env.OPENAI_API_KEY = 'test-openai-key'
    runBenchmarkSweepMock.mockReset()
    pgrestImpl = async (_method, path) => {
      if (path.includes('copilots?id=eq.')) {
        return [{ runtime: 'custom' }]
      }
      return []
    }
  })

  afterEach(() => {
    process.env.AMC_DATA_SOURCE = saved.src
    process.env.AMC_SUPABASE_URL = saved.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key
    process.env.OPENAI_API_KEY = saved.openai
  })

  it('A — valid body runs the sweep and returns the aggregate untouched', async () => {
    runBenchmarkSweepMock.mockResolvedValue(fakeSweepResult())

    const res = await POST(
      req({ suiteId: 'suite-1', models: [{ modelProvider: 'local', model: 'local-qwen-7b' }] }),
      { params }
    )
    expect(res.status).toBe(200)
    const payload = (await res.json()) as { ok: boolean; sweep: BenchmarkSweepResult }
    expect(payload.ok).toBe(true)
    // Aggregate rendered fidelity: ran + skipped legs both come through as-is,
    // and the skipped leg never carries a score.
    expect(payload.sweep.legs).toHaveLength(2)
    expect(payload.sweep.legs[0]).toMatchObject({ status: 'ran', score: 82 })
    expect(payload.sweep.legs[1]).toMatchObject({
      status: 'skipped',
      skipReason: 'provider-unavailable',
    })
    expect('score' in payload.sweep.legs[1]).toBe(false)
    expect(payload.sweep.best).toEqual({ model: 'local-qwen-7b', modelProvider: 'local', score: 82 })

    expect(runBenchmarkSweepMock).toHaveBeenCalledWith(
      expect.objectContaining({
        copilotId: COPILOT_ID,
        suiteId: 'suite-1',
        runtime: 'custom',
        models: [{ modelProvider: 'local', model: 'local-qwen-7b' }],
      })
    )
  })

  it('B1 — invalid copilotId is a 400, sweep never called', async () => {
    const res = await POST(req({ suiteId: 'suite-1', models: [{ modelProvider: 'local', model: 'x' }] }), {
      params: Promise.resolve({ copilotId: 'not valid id!!' }),
    })
    expect(res.status).toBe(400)
    expect(runBenchmarkSweepMock).not.toHaveBeenCalled()
  })

  it('B2 — missing suiteId is a 400', async () => {
    const res = await POST(req({ models: [{ modelProvider: 'local', model: 'x' }] }), { params })
    expect(res.status).toBe(400)
    expect(runBenchmarkSweepMock).not.toHaveBeenCalled()
  })

  it('B3 — empty models array is a 400', async () => {
    const res = await POST(req({ suiteId: 'suite-1', models: [] }), { params })
    expect(res.status).toBe(400)
    expect(runBenchmarkSweepMock).not.toHaveBeenCalled()
  })

  it('B4 — an out-of-enum provider (e.g. retired mistral) is a 400, never cast through', async () => {
    const res = await POST(
      req({ suiteId: 'suite-1', models: [{ modelProvider: 'mistral', model: 'mistral-large' }] }),
      { params }
    )
    expect(res.status).toBe(400)
    expect(runBenchmarkSweepMock).not.toHaveBeenCalled()
  })

  it('B5 — too many models entries is a 400', async () => {
    const models = Array.from({ length: 9 }, (_, i) => ({ modelProvider: 'local', model: `m-${i}` }))
    const res = await POST(req({ suiteId: 'suite-1', models }), { params })
    expect(res.status).toBe(400)
    expect(runBenchmarkSweepMock).not.toHaveBeenCalled()
  })

  it('B6 — invalid JSON body is a 400', async () => {
    const badReq = new Request('http://test/sweep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })
    const res = await POST(badReq, { params })
    expect(res.status).toBe(400)
    expect(runBenchmarkSweepMock).not.toHaveBeenCalled()
  })

  it('C — live backend not configured is a 503, sweep never called', async () => {
    process.env.AMC_DATA_SOURCE = 'mock'
    const res = await POST(
      req({ suiteId: 'suite-1', models: [{ modelProvider: 'local', model: 'x' }] }),
      { params }
    )
    expect(res.status).toBe(503)
    expect(runBenchmarkSweepMock).not.toHaveBeenCalled()
  })

  it('D — copilot not found (empty runtime lookup) is a 404', async () => {
    pgrestImpl = async () => []
    const res = await POST(
      req({ suiteId: 'suite-1', models: [{ modelProvider: 'local', model: 'x' }] }),
      { params }
    )
    expect(res.status).toBe(404)
    expect(runBenchmarkSweepMock).not.toHaveBeenCalled()
  })

  it('E — pgrest timeout while reading runtime maps to 504', async () => {
    pgrestImpl = async () => {
      throw new Error('TIMEOUT')
    }
    const res = await POST(
      req({ suiteId: 'suite-1', models: [{ modelProvider: 'local', model: 'x' }] }),
      { params }
    )
    expect(res.status).toBe(504)
  })

  it('F — sweep throwing outright (not a leg failure) maps to a generic 502', async () => {
    runBenchmarkSweepMock.mockRejectedValue(new Error('boom: internal detail'))
    const res = await POST(
      req({ suiteId: 'suite-1', models: [{ modelProvider: 'local', model: 'x' }] }),
      { params }
    )
    expect(res.status).toBe(502)
    const payload = (await res.json()) as { error: string }
    expect(payload.error).toBe('benchmark sweep failed')
    expect(payload.error).not.toContain('internal detail')
  })
})
