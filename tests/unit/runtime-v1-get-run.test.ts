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
      tenant: { kind: 'legacy-unscoped' as const, projectId: null, installationId: null },
    })),
    tenantCanSeeProject: vi.fn(() => true),
  }
})

import { pgrest } from '@/lib/agent-mission-control/postgrest'
import { GET } from '@/app/api/runtime/v1/runs/[runId]/route'
import { RUNTIME_CONTRACT_VERSION } from '@/lib/agent-mission-control/runtime-api-types'

/**
 * The row shape the endpoint reads. Deliberately mirrors the REAL `agent_runs`
 * columns (migrations 0001 + 0020) — it MUST NOT invent columns, because a
 * fabricated column here is exactly how the phantom-column 502 shipped green:
 * the old test mocked `fallback_used`/`interrupted` into the row, so it could
 * never exercise the select that PostgREST rejects in production.
 */
function realRunRow(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  }
}

describe('GET /api/runtime/v1/runs/[runId]', () => {
  beforeEach(() => {
    vi.mocked(pgrest).mockReset()
  })

  it('returns cost and provider metadata on read', async () => {
    vi.mocked(pgrest).mockResolvedValueOnce([realRunRow()])

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
    // Not persisted anywhere → reported as null, never fabricated.
    expect(body.fallbackUsed).toBeNull()
    expect(body.interrupted).toBeNull()
  })

  it('never selects columns that do not exist in agent_runs (regression: phantom-column 502)', async () => {
    vi.mocked(pgrest).mockResolvedValueOnce([realRunRow()])
    await GET(new Request('http://localhost/api/runtime/v1/runs/run-abc'), {
      params: Promise.resolve({ runId: 'run-abc' }),
    })
    // The PostgREST query string must reference only real columns. Selecting
    // `fallback_used` or `interrupted` makes PostgREST return 42703 → 502.
    const query = vi.mocked(pgrest).mock.calls[0]?.[1] as string
    expect(query).toContain('select=')
    expect(query).not.toContain('fallback_used')
    expect(query).not.toContain('interrupted')
  })

  it('preserves null for unmeasured cost/provider/model (never coerced to 0 or a default)', async () => {
    vi.mocked(pgrest).mockResolvedValueOnce([
      realRunRow({
        cost_usd: null,
        resolved_provider: null,
        resolved_model: null,
        model_unverified: null,
        latency_ms: null,
      }),
    ])

    const res = await GET(new Request('http://localhost/api/runtime/v1/runs/run-abc'), {
      params: Promise.resolve({ runId: 'run-abc' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.costUsd).toBeNull()
    expect(body.resolvedProvider).toBeNull()
    expect(body.resolvedModel).toBeNull()
    expect(body.modelUnverified).toBeNull()
    expect(body.latencyMs).toBeNull()
  })

  it('returns 404 (not 502) for a valid but unknown run id — select succeeds, no row', async () => {
    vi.mocked(pgrest).mockResolvedValueOnce([])

    const res = await GET(new Request('http://localhost/api/runtime/v1/runs/run-missing'), {
      params: Promise.resolve({ runId: 'run-missing' }),
    })
    expect(res.status).toBe(404)
  })
})
