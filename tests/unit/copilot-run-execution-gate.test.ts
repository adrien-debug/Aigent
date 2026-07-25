/**
 * AIG-TRADEAGENT-EXECUTION-GATE-020 — the run route must be fail-closed on
 * canonical executability.
 *
 * Before this gate the route checked project/version/manifest only, so a
 * `degraded` copilot started real runs: its declared tools resolved to no
 * handler, every call was refused at guardrail time, and the run still spent a
 * live model call. An archived copilot was refused only as a side effect of its
 * NULL project_id.
 *
 * Pure, OFFLINE: the canonical catalogue, PostgREST, the runner and the auth
 * gate are mocked at module level. NO network, NO DB, NO model call, NO secret.
 * What is under test is the ORDER and the REFUSALS, not the catalogue
 * derivation (pinned separately in tradeagent-only-roster.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Canonical = {
  copilotId: string
  status: 'active' | 'inactive' | 'degraded' | 'unavailable'
  unresolvedToolIds: string[]
  unavailableFields: string[]
  runtime?: string | null
}

let canonicalAgent: Canonical | undefined
let catalogueThrows: Error | null = null
const executeCopilotRun = vi.fn()

vi.mock('@/lib/agent-mission-control/available-agents', () => ({
  getAvailableAgent: vi.fn(async () => {
    if (catalogueThrows) throw catalogueThrows
    // Default runtime to langgraph so pre-existing mocks pass the runtime gate; a
    // test overrides `canonicalAgent.runtime` to exercise the non-langgraph refusal.
    return canonicalAgent ? { runtime: 'langgraph', ...canonicalAgent } : undefined
  }),
}))

vi.mock('@/lib/agent-mission-control/runner', () => ({
  executeCopilotRun: (...args: unknown[]) => executeCopilotRun(...args),
}))

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  // Routed by query shape: the same helper serves tool-name resolution (for the
  // 409 message) and the copilot/version loads that run AFTER the gate.
  pgrest: vi.fn(async (_method: string, path: string) => {
    if (path.startsWith('tools?')) {
      return [
        { id: 'tool-read-repo-file-d71c2f18', name: 'read_repo_file' },
        { id: 'tool-list-repo-tree-aa11', name: 'list_repo_tree' },
      ]
    }
    if (path.startsWith('copilots?')) {
      return [
        {
          name: 'BTC Alert & Levels Sentinel',
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

const ACTIVE_ID = 'copilot-btc-alert-levels-sentinel-draft-a732b361-c9b7fa5c'

function request(body: unknown = { userInput: 'probe' }) {
  return new Request('http://localhost/api/agent-ops/copilots/x/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function post(copilotId: string, body?: unknown) {
  const mod = await import('@/app/api/agent-ops/copilots/[copilotId]/run/route')
  return mod.POST(request(body), { params: Promise.resolve({ copilotId }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  catalogueThrows = null
  // The route refuses early unless the live backend is configured; these are
  // shape-only placeholders, never real credentials.
  process.env.AMC_DATA_SOURCE = 'gpu1'
  process.env.AMC_SUPABASE_URL = 'http://127.0.0.1:1/stub'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-not-a-secret'
  process.env.OPENAI_API_KEY = 'test-only-not-a-secret'
})

describe('run route — fail-closed execution gate', () => {
  it('refuses a degraded copilot with 409 and names the unresolved tools', async () => {
    canonicalAgent = {
      copilotId: 'copilot-tradeagent-market-intelligence-b1c8c291',
      status: 'degraded',
      unresolvedToolIds: ['tool-read-repo-file-d71c2f18', 'tool-list-repo-tree-aa11'],
      unavailableFields: [],
    }
    const res = await post('copilot-tradeagent-market-intelligence-b1c8c291')
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('copilot is not executable')
    expect(body.status).toBe('degraded')
    expect(body.reasons.join(' ')).toContain('read_repo_file')
    // The decisive assertion: no model call was ever reached.
    expect(executeCopilotRun).not.toHaveBeenCalled()
  })

  it('refuses an archived/unavailable copilot', async () => {
    canonicalAgent = {
      copilotId: 'copilot-atlas-market-structure-6836ef1e',
      status: 'unavailable',
      unresolvedToolIds: [],
      unavailableFields: [],
    }
    const res = await post('copilot-atlas-market-structure-6836ef1e')
    expect(res.status).toBe(409)
    expect((await res.json()).status).toBe('unavailable')
    expect(executeCopilotRun).not.toHaveBeenCalled()
  })

  it('refuses an inactive copilot', async () => {
    canonicalAgent = { copilotId: 'c', status: 'inactive', unresolvedToolIds: [], unavailableFields: [] }
    const res = await post('copilot-some-inactive-agent')
    expect(res.status).toBe(409)
    expect(executeCopilotRun).not.toHaveBeenCalled()
  })

  it('refuses a non-langgraph runtime (LangGraph is the only executable product runtime)', async () => {
    canonicalAgent = {
      copilotId: 'copilot-legacy-openai-agent-11223344',
      status: 'active',
      unresolvedToolIds: [],
      unavailableFields: [],
      runtime: 'openai-assistants',
    }
    const res = await post('copilot-legacy-openai-agent-11223344')
    expect(res.status).toBe(409)
    expect((await res.json()).reasons.join(' ')).toMatch(/langgraph/i)
    expect(executeCopilotRun).not.toHaveBeenCalled()
  })

  it('refuses an ACTIVE copilot that still declares an unresolved tool', async () => {
    // Status alone is not sufficient — this is the case a naive `status ===
    // active` check would wave through.
    canonicalAgent = {
      copilotId: ACTIVE_ID,
      status: 'active',
      unresolvedToolIds: ['tool-read-repo-file-d71c2f18'],
      unavailableFields: [],
    }
    const res = await post(ACTIVE_ID)
    expect(res.status).toBe(409)
    expect((await res.json()).reasons.join(' ')).toContain('unresolved tools')
    expect(executeCopilotRun).not.toHaveBeenCalled()
  })

  it('returns 404 when the copilot is absent from the canonical catalogue', async () => {
    canonicalAgent = undefined
    const res = await post('copilot-does-not-exist-abc123')
    expect(res.status).toBe(404)
    expect(executeCopilotRun).not.toHaveBeenCalled()
  })

  it('returns 503 when the catalogue itself is unreachable', async () => {
    // Unknown executability must never fall through to "probably fine".
    canonicalAgent = undefined
    catalogueThrows = new Error('catalogue down')
    const res = await post(ACTIVE_ID)
    expect(res.status).toBe(503)
    expect(executeCopilotRun).not.toHaveBeenCalled()
  })

  it('returns 503 when the live backend is not configured', async () => {
    delete process.env.AMC_DATA_SOURCE
    canonicalAgent = { copilotId: ACTIVE_ID, status: 'active', unresolvedToolIds: [], unavailableFields: [] }
    const res = await post(ACTIVE_ID)
    expect(res.status).toBe(503)
    expect(executeCopilotRun).not.toHaveBeenCalled()
  })

  it('still rejects a malformed body before touching the catalogue', async () => {
    canonicalAgent = { copilotId: ACTIVE_ID, status: 'active', unresolvedToolIds: [], unavailableFields: [] }
    expect((await post(ACTIVE_ID, { userInput: '   ' })).status).toBe(400)
    expect((await post(ACTIVE_ID, null)).status).toBe(400)
    expect(executeCopilotRun).not.toHaveBeenCalled()
  })

  it('lets a fully executable copilot through to the runner', async () => {
    // The gate must not become a wall: the happy path still reaches execution.
    canonicalAgent = { copilotId: ACTIVE_ID, status: 'active', unresolvedToolIds: [], unavailableFields: [] }
    executeCopilotRun.mockResolvedValue({
      runId: 'run-1',
      status: 'completed',
      outputSummary: 'ok',
      latencyMs: 10,
      costUsd: 0.001,
      traceUrl: null,
      resolvedProvider: 'openai',
      resolvedModel: 'gpt-5.4',
      fallbackUsed: false,
      modelUnverified: false,
      interrupted: false,
      interruptMessage: null,
      pendingTool: null,
    })
    const res = await post(ACTIVE_ID)
    // Past the gate: any non-409/404/503 proves the guard did not block it.
    expect([200, 502, 504]).toContain(res.status)
    expect(res.status).not.toBe(409)
  })
})
