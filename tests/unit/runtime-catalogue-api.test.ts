import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * AIG-RUNTIME-002 — the published catalogue API, pinned.
 *
 * These are the guarantees a consumer repo (TradeAgent) builds on. The sharp
 * one is that `executable` — not `status` — decides whether a run may start,
 * and that the gate is re-read at execution time rather than trusted from
 * whatever the consumer last fetched.
 *
 * Pure, OFFLINE: catalogue, PostgREST and the runner are mocked. NO network,
 * NO DB, NO model call, NO secret.
 */

type Published = {
  id: string
  status: string
  executable: boolean
  nonExecutableReasons: string[]
}

let catalogueAgent: Published | undefined
let catalogueThrows: Error | null = null
const executeCopilotRun = vi.fn()

vi.mock('@/lib/agent-mission-control/runtime-catalogue', () => ({
  getPublishedAgent: vi.fn(async () => {
    if (catalogueThrows) throw catalogueThrows
    return catalogueAgent
  }),
  getPublishedAgents: vi.fn(async () => {
    if (catalogueThrows) throw catalogueThrows
    return catalogueAgent ? [catalogueAgent] : []
  }),
}))

vi.mock('@/lib/agent-mission-control/runner', () => ({
  executeCopilotRun: (...args: unknown[]) => executeCopilotRun(...args),
}))

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async (_m: string, path: string) => {
    if (path.startsWith('copilots?')) {
      return [
        {
          name: 'Market Intelligence',
          model: 'gpt-5.4',
          model_provider: 'openai',
          project_id: 'proj-tradeagent',
          production_version_id: null,
          latest_version_id: 'ver-1',
        },
      ]
    }
    if (path.startsWith('copilot_versions?')) return [{ manifest_id: 'man-1' }]
    if (path.startsWith('manifests?')) return [{ system_prompt_summary: 'You are a test agent.', max_steps_per_run: 4 }]
    return []
  }),
  isPgrestTimeout: () => false,
}))

const TOKEN = 'test-token-not-a-real-secret'
const AGENT_ID = 'copilot-market-intelligence'

function req(token?: string, body?: unknown) {
  return new Request(`http://localhost/api/runtime/v1/agents/${AGENT_ID}/runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? { input: 'probe' }),
  })
}

async function postRun(token?: string, body?: unknown) {
  const mod = await import('@/app/api/runtime/v1/agents/[agentId]/runs/route')
  return mod.POST(req(token, body), { params: Promise.resolve({ agentId: AGENT_ID }) })
}

async function getList(token?: string) {
  const mod = await import('@/app/api/runtime/v1/agents/route')
  return mod.GET(
    new Request('http://localhost/api/runtime/v1/agents', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  catalogueThrows = null
  catalogueAgent = { id: AGENT_ID, status: 'active', executable: true, nonExecutableReasons: [] }
  process.env.AIGENT_RUNTIME_API_TOKEN = TOKEN
  process.env.AMC_DATA_SOURCE = 'gpu1'
  process.env.AMC_SUPABASE_URL = 'http://127.0.0.1:1/stub'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-not-a-secret'
  process.env.OPENAI_API_KEY = 'test-only-not-a-secret'
})

describe('runtime catalogue API — auth', () => {
  it('refuses a missing token with 401', async () => {
    expect((await getList()).status).toBe(401)
  })

  it('refuses a wrong token with 401', async () => {
    expect((await getList('nope')).status).toBe(401)
  })

  it('answers 503 when the API is not configured at all', async () => {
    // Not a caller error: the server has no token, so it cannot authenticate.
    delete process.env.AIGENT_RUNTIME_API_TOKEN
    expect((await getList(TOKEN)).status).toBe(503)
  })

  it('never echoes the provided token', async () => {
    const res = await getList('some-attacker-value')
    expect(JSON.stringify(await res.json())).not.toContain('some-attacker-value')
  })
})

describe('runtime catalogue API — run gate', () => {
  it('starts a run for an executable agent', async () => {
    executeCopilotRun.mockResolvedValue({
      runId: 'run-1',
      status: 'completed',
      outputSummary: 'ok',
      latencyMs: 10,
      costUsd: 0.001,
      resolvedProvider: 'openai',
      resolvedModel: 'gpt-5.4',
      modelUnverified: false,
      fallbackUsed: false,
      interrupted: false,
    })
    const res = await postRun(TOKEN)
    expect(res.status).toBe(200)
    expect(executeCopilotRun).toHaveBeenCalledOnce()
  })

  it('refuses a non-executable agent with 409 and states why', async () => {
    catalogueAgent = {
      id: AGENT_ID,
      status: 'inactive',
      executable: false,
      nonExecutableReasons: ['configured but not activated — activation requires a proven run'],
    }
    const res = await postRun(TOKEN)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.reasons.join(' ')).toContain('not activated')
    // The decisive assertion: no model call was ever reached.
    expect(executeCopilotRun).not.toHaveBeenCalled()
  })

  it('refuses an agent that is active but has unresolved tools', async () => {
    // `status` alone would wave this through; `executable` is what decides.
    catalogueAgent = {
      id: AGENT_ID,
      status: 'active',
      executable: false,
      nonExecutableReasons: ['1 declared tool has no registered handler'],
    }
    expect((await postRun(TOKEN)).status).toBe(409)
    expect(executeCopilotRun).not.toHaveBeenCalled()
  })

  it('answers 404 for an agent absent from the catalogue', async () => {
    catalogueAgent = undefined
    expect((await postRun(TOKEN)).status).toBe(404)
    expect(executeCopilotRun).not.toHaveBeenCalled()
  })

  it('answers 503 when the catalogue is unreachable', async () => {
    catalogueThrows = new Error('catalogue down')
    expect((await postRun(TOKEN)).status).toBe(503)
    expect(executeCopilotRun).not.toHaveBeenCalled()
  })

  it('answers 503 when the live backend is not configured', async () => {
    delete process.env.AMC_DATA_SOURCE
    expect((await postRun(TOKEN)).status).toBe(503)
    expect(executeCopilotRun).not.toHaveBeenCalled()
  })

  it('rejects a malformed body before touching the catalogue', async () => {
    expect((await postRun(TOKEN, { input: '   ' })).status).toBe(400)
    expect((await postRun(TOKEN, {})).status).toBe(400)
    expect(executeCopilotRun).not.toHaveBeenCalled()
  })
})
