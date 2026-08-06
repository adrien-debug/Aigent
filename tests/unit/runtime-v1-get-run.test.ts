import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(),
  isPgrestTimeout: vi.fn(() => false),
}))

vi.mock('@/lib/agent-mission-control/runtime-api-types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent-mission-control/runtime-api-types')>()
  return {
    ...actual,
    resolveRuntimeTenant: vi.fn(async () => ({
      ok: true as const,
      tenant: { kind: 'legacy' as const },
    })),
    tenantCanSeeProject: vi.fn(() => true),
  }
})

import { pgrest } from '@/lib/agent-mission-control/postgrest'
import { GET } from '@/app/api/runtime/v1/runs/[runId]/route'
import { RUNTIME_CONTRACT_VERSION } from '@/lib/agent-mission-control/runtime-api-types'

describe('GET /api/runtime/v1/runs/[runId]', () => {
  beforeEach(() => {
    vi.mocked(pgrest).mockReset()
  })

  it('returns cost and provider metadata on read', async () => {
    vi.mocked(pgrest).mockResolvedValueOnce([
      {
        id: 'run-abc',
        copilot_id: 'copilot-1',
        project_id: 'proj-1',
        status: 'completed',
        input_summary: 'hello',
        output_summary: 'world',
        started_at: '2026-08-06T00:00:00Z',
        finished_at: '2026-08-06T00:00:01Z',
        latency_ms: 1000,
        cost_usd: 0.01,
        resolved_provider: 'openai',
        resolved_model: 'gpt-5.4',
        model_unverified: false,
        fallback_used: false,
        interrupted: false,
      },
    ])

    const res = await GET(new Request('http://localhost/api/runtime/v1/runs/run-abc'), {
      params: Promise.resolve({ runId: 'run-abc' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.contractVersion).toBe(RUNTIME_CONTRACT_VERSION)
    expect(body.costUsd).toBe(0.01)
    expect(body.resolvedProvider).toBe('openai')
    expect(body.resolvedModel).toBe('gpt-5.4')
    expect(body.latencyMs).toBe(1000)
  })
})
