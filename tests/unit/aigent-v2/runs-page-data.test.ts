/**
 * AIGENT-FRONTEND-RESET-001 — the V2 server loader.
 *
 * Pinned here: the load-bearing read fails CLOSED (throws, so the route error
 * boundary renders) while a secondary read failing degrades to a disclosed
 * partial state. The failure mode this forbids is the dangerous one — a
 * backend outage rendering as an empty, healthy-looking fleet.
 *
 * Pure and OFFLINE: `pgrest` is mocked per path prefix, `next/headers` is
 * stubbed. No network, no DB, no secret.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

type RawRow = Record<string, unknown>

let copilotRows: RawRow[] | Error = []
let projectRows: RawRow[] | Error = []
let runRows: RawRow[] | Error = []

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'stub-session' }) }),
}))

vi.mock('@/lib/agent-mission-control/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent-mission-control/auth')>()
  return {
    ...actual,
    decodeSession: () => ({ sub: 'admin', role: 'admin', issuedAt: 0, expiresAt: 0 }),
  }
})

vi.mock('@/lib/agent-mission-control/postgrest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent-mission-control/postgrest')>()
  return {
    ...actual,
    pgrest: vi.fn(async (_method: string, pathAndQuery: string) => {
      const pick = (v: RawRow[] | Error) => {
        if (v instanceof Error) throw v
        return v
      }
      if (pathAndQuery.startsWith('copilots')) return pick(copilotRows)
      if (pathAndQuery.startsWith('projects')) return pick(projectRows)
      if (pathAndQuery.startsWith('agent_runs')) return pick(runRows)
      // getCopilots' health/24h-KPI batches — not part of this contract.
      return []
    }),
  }
})

import { getRunsPageData } from '@/lib/aigent-v2/runs-page-data'

function copilotRow(overrides: RawRow = {}): RawRow {
  return {
    id: 'copilot-market-intelligence',
    project_id: 'proj-tradeagent',
    target_project_ids: [],
    name: 'Market Intelligence',
    slug: 'market-intelligence',
    description: '',
    runtime: 'langgraph',
    status: 'active',
    production_version_id: 'ver-1',
    latest_version_id: 'ver-1',
    model: 'gpt-5.4',
    model_provider: 'openai',
    owner: 'adrien',
    tags: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    health: {},
    ...overrides,
  }
}

function projectRow(overrides: RawRow = {}): RawRow {
  return {
    id: 'proj-tradeagent',
    name: 'TradeAgent',
    slug: 'tradeagent',
    description: '',
    platform: 'web',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function runRow(overrides: RawRow = {}): RawRow {
  return {
    id: 'run-1',
    copilot_id: 'copilot-market-intelligence',
    version_id: 'ver-1',
    project_id: 'proj-tradeagent',
    user_label: 'nightly',
    started_at: '2026-07-29T10:00:00.000Z',
    finished_at: '2026-07-29T10:00:12.000Z',
    status: 'completed',
    input_summary: 'in',
    output_summary: 'out',
    tool_call_count: 5,
    unsafe_attempt_count: 0,
    latency_ms: 12000,
    cost_usd: '0.0246',
    trace_url: null,
    resolved_model: 'gpt-5.4',
    resolved_provider: 'openai',
    model_unverified: false,
    agent_run_steps: [],
    ...overrides,
  }
}

afterEach(() => {
  copilotRows = []
  projectRows = []
  runRows = []
  vi.clearAllMocks()
})

describe('getRunsPageData', () => {
  it('composes the existing getters into one cockpit dataset', async () => {
    copilotRows = [copilotRow()]
    projectRows = [projectRow()]
    runRows = [runRow()]

    const data = await getRunsPageData()

    expect(data.runs).toHaveLength(1)
    expect(data.agentNameById.get('copilot-market-intelligence')).toBe('Market Intelligence')
    expect(data.projectNameById.get('proj-tradeagent')).toBe('TradeAgent')
    expect(data.degraded).toEqual([])
    expect(data.windowTruncated).toBe(false)
  })

  it('reports the real session role and never invents an identity', async () => {
    copilotRows = [copilotRow()]
    runRows = [runRow()]

    const data = await getRunsPageData()

    expect(data.viewer).toEqual({ role: 'admin', authenticated: true })
  })

  it('THROWS when the runs read fails — an outage must not render as an empty fleet', async () => {
    copilotRows = [copilotRow()]
    projectRows = [projectRow()]
    runRows = new Error('gpu1 unreachable')

    await expect(getRunsPageData()).rejects.toThrow('gpu1 unreachable')
  })

  it('degrades to a disclosed partial state when only the agent catalogue fails', async () => {
    copilotRows = new Error('copilots table unreadable')
    projectRows = [projectRow()]
    runRows = [runRow()]

    const data = await getRunsPageData()

    // The runs are real and still shown; the missing labels are declared.
    expect(data.runs).toHaveLength(1)
    expect(data.degraded).toContain('agents')
    expect(data.degradedDetail).toContain('agents')
    expect(data.agentNameById.size).toBe(0)
  })

  it('degrades when only the project catalogue fails', async () => {
    copilotRows = [copilotRow()]
    projectRows = new Error('projects table unreadable')
    runRows = [runRow()]

    const data = await getRunsPageData()

    expect(data.runs).toHaveLength(1)
    expect(data.degraded).toEqual(['projects'])
  })

  it('surfaces a null cost as null rather than coercing it to zero', async () => {
    copilotRows = [copilotRow()]
    runRows = [runRow({ cost_usd: null })]

    const data = await getRunsPageData()

    expect(data.runs[0]!.costUsd).toBeNull()
  })

  it('never fabricates a model for a run that never proved one', async () => {
    copilotRows = [copilotRow()]
    runRows = [runRow({ resolved_model: null, resolved_provider: null, model_unverified: undefined })]

    const data = await getRunsPageData()

    expect(data.runs[0]!.resolvedModel).toBeFalsy()
  })

  it('returns an empty run list without degradation when the backend genuinely has none', async () => {
    copilotRows = [copilotRow()]
    projectRows = [projectRow()]
    runRows = []

    const data = await getRunsPageData()

    // A real "nothing ran" is distinct from a failure — no degraded flag here.
    expect(data.runs).toEqual([])
    expect(data.degraded).toEqual([])
  })
})
