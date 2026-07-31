/**
 * `assistantId` / `runtimeProvisioned` — the bare-graph signal.
 *
 * The failure being guarded against is SILENT: a `langgraph` copilot without a
 * provisioned `assistant_id` does not error. It runs against the bare graph,
 * inherits the legacy generic tools, and answers with zero tool calls while
 * every other field of the canonical contract reads healthy. These tests pin
 * the three states apart — provisioned, measurably missing, and not applicable
 * — because collapsing "not applicable" into `false` would raise an alert on
 * agents where no assistant is ever expected.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async () => []),
}))

type Row = Record<string, unknown>

const COPILOT: Row = {
  id: 'cop-1',
  project_id: 'proj-1',
  name: 'Agent A',
  description: 'desc',
  status: 'active',
  runtime: 'langgraph',
  model: 'gpt-5.4',
  model_provider: 'openai',
  assistant_id: 'asst_123',
  production_version_id: 'ver-1',
  latest_version_id: 'ver-1',
}

/**
 * Routes each PostgREST path to a canned table, so a test only states the rows
 * it cares about. Deliberately keyed on the path prefix the loader actually
 * builds — a `select=` that stops asking for `assistant_id` still reaches the
 * `copilots` branch, which is exactly the "column not read" case below.
 */
function mockBackend(copilot: Row) {
  return async (_method: string, pathAndQuery: string) => {
    if (pathAndQuery.startsWith('copilots?')) {
      // Honour the select: a column absent from `select=` must arrive
      // `undefined`, the way PostgREST really behaves.
      const select = /select=([^&]+)/.exec(pathAndQuery)?.[1] ?? ''
      const cols = new Set(select.split(','))
      const projected: Row = {}
      for (const [k, v] of Object.entries(copilot)) if (cols.has(k)) projected[k] = v
      return [projected]
    }
    if (pathAndQuery.startsWith('projects?')) return [{ id: 'proj-1' }]
    if (pathAndQuery.startsWith('tools?')) {
      return [
        {
          id: 'tool-1',
          copilot_id: 'cop-1',
          name: 'read_project_summary',
          enabled: true,
          risk_level: 'low',
          requires_confirmation: false,
          mutates: false,
        },
      ]
    }
    if (pathAndQuery.startsWith('copilot_versions?')) {
      return [{ id: 'ver-1', copilot_id: 'cop-1', label: 'v1.0.0', stage: 'production', manifest_id: 'man-1' }]
    }
    if (pathAndQuery.startsWith('manifests?')) {
      return [
        {
          id: 'man-1',
          copilot_id: 'cop-1',
          tool_ids: ['tool-1'],
          skills: [],
          confirmation_policy: 'never',
          forbidden_actions: [],
          updated_at: '2026-07-31T00:00:00Z',
        },
      ]
    }
    return []
  }
}

async function loadOne(copilot: Row) {
  const postgrest = await import('@/lib/agent-mission-control/postgrest')
  vi.mocked(postgrest.pgrest).mockImplementation(
    mockBackend(copilot) as unknown as typeof postgrest.pgrest
  )
  const { getAvailableAgents } = await import('@/lib/agent-mission-control/available-agents')
  const [agent] = await getAvailableAgents()
  expect(agent).toBeDefined()
  return agent!
}

describe('available-agents — assistant provisioning signal', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('reads assistant_id from the copilots select (the column is actually asked for)', async () => {
    const postgrest = await import('@/lib/agent-mission-control/postgrest')
    vi.mocked(postgrest.pgrest).mockImplementation(
      mockBackend(COPILOT) as unknown as typeof postgrest.pgrest
    )
    const { getAvailableAgents } = await import('@/lib/agent-mission-control/available-agents')
    await getAvailableAgents()

    const copilotCall = vi
      .mocked(postgrest.pgrest)
      .mock.calls.find(([, q]) => String(q).startsWith('copilots?'))
    expect(copilotCall?.[1]).toContain('assistant_id')
  })

  it('assistant present on langgraph → provisioned, and neither field is "unavailable"', async () => {
    const agent = await loadOne(COPILOT)

    expect(agent.assistantId).toBe('asst_123')
    expect(agent.runtimeProvisioned).toBe(true)
    expect(agent.unavailableFields).not.toContain('assistantId')
    expect(agent.unavailableFields).not.toContain('runtimeProvisioned')
  })

  it('assistant absent on langgraph → MEASURED false: the bare-graph trap', async () => {
    const agent = await loadOne({ ...COPILOT, assistant_id: null })

    expect(agent.assistantId).toBeNull()
    // `false`, not null: on langgraph the question was asked AND answered.
    expect(agent.runtimeProvisioned).toBe(false)
    expect(agent.unavailableFields).toContain('assistantId')
    expect(agent.unavailableFields).not.toContain('runtimeProvisioned')
    // The whole point: nothing else in the contract flags this agent.
    expect(agent.status).toBe('active')
    expect(agent.executable).toBe(true)
  })

  it('empty-string assistant_id counts as absent, not as a provisioned id', async () => {
    const agent = await loadOne({ ...COPILOT, assistant_id: '   ' })

    expect(agent.assistantId).toBeNull()
    expect(agent.runtimeProvisioned).toBe(false)
  })

  it('non-langgraph runtime → null (NOT APPLICABLE), never a false alarm', async () => {
    const agent = await loadOne({ ...COPILOT, runtime: 'http', assistant_id: null })

    expect(agent.assistantId).toBeNull()
    // An absent assistant is not a defect where nothing provisions one.
    expect(agent.runtimeProvisioned).toBeNull()
    expect(agent.unavailableFields).toContain('runtimeProvisioned')
  })

  it('unresolved runtime column → null, not false', async () => {
    const agent = await loadOne({ ...COPILOT, runtime: null, assistant_id: null })

    expect(agent.runtimeProvisioned).toBeNull()
    expect(agent.unavailableFields).toContain('runtime')
    expect(agent.unavailableFields).toContain('runtimeProvisioned')
  })

  it('column NOT read → UNKNOWN, never "not provisioned"', async () => {
    // Simulates a loader whose `select=` dropped the column: PostgREST returns
    // the row without the key, so `assistant_id` is `undefined` — which must
    // NOT be read as "no assistant" on a langgraph agent.
    const { assistant_id: _dropped, ...withoutColumn } = COPILOT
    const agent = await loadOne(withoutColumn)

    expect(agent.assistantId).toBeNull()
    expect(agent.runtimeProvisioned).toBeNull()
    expect(agent.unavailableFields).toContain('assistantId')
    expect(agent.unavailableFields).toContain('runtimeProvisioned')
  })
})
