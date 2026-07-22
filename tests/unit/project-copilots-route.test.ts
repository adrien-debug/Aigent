/**
 * Unit tests for GET /api/agent-ops/projects/:id/copilots
 * (src/app/api/agent-ops/projects/[id]/copilots/route.ts), the external
 * partner-facing copilot catalog, plus the identity gate that fronts it
 * (src/proxy.ts) and the two pure mapping functions it exports.
 *
 * Pure and offline: the data layer (`data.ts`) and `postgrest` are mocked at
 * top level — NO network, NO gpu1, NO secrets, and crucially NO OpenAI call
 * (this route never runs a copilot; the run route that DOES call OpenAI is
 * covered by a separate, manually-triggered canary, never an automated test).
 *
 * The manifest fixtures below are the REAL, live-verified shapes of the two
 * TradeAgent copilots (`copilot-tradeagent-market-intelligence-b1c8c291`,
 * `copilot-tradeagent-portfolio-risk-guardian-91f81963`):
 *   outputContract.invariants: ["read-only", "never fabricates unavailable metrics"]
 *   forbiddenActions:          ["execute withdrawals", "place orders",
 *                               "write to external systems"]
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentManifest, Copilot, ToolDefinition } from '@/lib/agent-mission-control/types'

// ---------------------------------------------------------------------------
// Top-level mocks — swappable per test via module-scoped handlers.
// ---------------------------------------------------------------------------

let copilotsHandler: () => Copilot[] = () => []
let manifestHandler: (copilotId: string) => AgentManifest | undefined = () => undefined
let toolsHandler: (copilotId: string) => ToolDefinition[] = () => []
let copilotsThrows: Error | null = null
let timeoutFlag = false

vi.mock('@/lib/agent-mission-control/data', () => ({
  getCopilots: vi.fn(async () => {
    if (copilotsThrows) throw copilotsThrows
    return copilotsHandler()
  }),
  getManifestForCopilot: vi.fn(async (id: string) => manifestHandler(id)),
  getToolsForCopilot: vi.fn(async (id: string) => toolsHandler(id)),
}))

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  isPgrestTimeout: () => timeoutFlag,
}))

import { NextRequest } from 'next/server'

import {
  GET,
  mapCopilotStatus,
  type ExternalCopilotStatus,
} from '@/app/api/agent-ops/projects/[id]/copilots/route'
import { deriveToolNatureReadOnly } from '@/lib/agent-mission-control/available-agents'
import type { CopilotStatus } from '@/lib/agent-mission-control/types'
import { proxy, config as proxyConfig } from '@/proxy'

const PROJECT_ID = 'proj-tradeagent'
const OTHER_PROJECT_ID = 'proj-bull21'

const MARKET_ID = 'copilot-tradeagent-market-intelligence-b1c8c291'
const RISK_ID = 'copilot-tradeagent-portfolio-risk-guardian-91f81963'

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}
function req(id: string): Request {
  return new Request(`http://localhost/api/agent-ops/projects/${id}/copilots`, { method: 'GET' })
}

/** A copilot row shaped like the live data (draft, TradeAgent, no 24h runs). */
function copilotFixture(overrides: Partial<Copilot> = {}): Copilot {
  return {
    id: MARKET_ID,
    projectId: PROJECT_ID,
    targetProjectIds: [],
    name: 'TradeAgent Market Intelligence',
    slug: 'tradeagent-market-intelligence',
    description: 'Reads market structure and reports, read-only.',
    runtime: 'openai-assistants',
    status: 'draft',
    productionVersionId: null,
    latestVersionId: 'ver-1',
    model: 'gpt-5.4',
    modelProvider: 'openai',
    owner: 'aigent',
    tags: [],
    createdAt: '2026-07-21T02:20:10.343Z',
    updatedAt: '2026-07-21T02:20:10.343Z',
    health: {
      testPassRate: 0,
      benchmarkScore: 0,
      runsLast24h: 0,
      errorRateLast24h: 0,
      avgLatencyMs: 0,
      costLast24hUsd: 0,
      openWarnings: 0,
    },
    ...overrides,
  }
}

/** The REAL, live-verified manifest shape of the two TradeAgent copilots. */
function readOnlyManifest(copilotId: string): AgentManifest {
  return {
    id: `manifest-${copilotId}`,
    copilotId,
    version: 'v0.1.0-draft',
    systemPromptSummary: 'INTERNAL — must never ship to a partner.',
    allowedRoutes: ['/api/market/*', '/api/internal/portfolio-risk/*'],
    forbiddenActions: ['execute withdrawals', 'place orders', 'write to external systems'],
    confirmationPolicy: 'risky-only',
    alwaysConfirmActions: [],
    memorySources: [],
    outputContract: {
      format: 'json',
      schemaName: 'tradeagent-market-intelligence.v1',
      invariants: ['read-only', 'never fabricates unavailable metrics'],
    },
    skills: [{ label: 'Read market structure' }],
    toolIds: [],
    maxStepsPerRun: 12,
    maxCostPerRunUsd: 0.25,
    updatedAt: '2026-07-21T02:20:10.343Z',
  }
}

const ENV = {
  AMC_DATA_SOURCE: 'gpu1',
  AMC_SUPABASE_URL: 'http://127.0.0.1:3999',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
}

describe('mapCopilotStatus (pure)', () => {
  const cases: Array<[CopilotStatus, ExternalCopilotStatus]> = [
    ['draft', 'draft'],
    ['active', 'available'],
    ['paused', 'suspended'],
    ['degraded', 'suspended'],
    ['archived', 'archived'],
  ]
  for (const [dbStatus, external] of cases) {
    it(`maps DB '${dbStatus}' -> '${external}'`, () => {
      expect(mapCopilotStatus(dbStatus)).toBe(external)
    })
  }

  it("never silently promotes 'draft' to 'available'", () => {
    expect(mapCopilotStatus('draft')).not.toBe('available')
  })
})

describe('deriveToolNatureReadOnly (pure) — the SINGLE shared readOnly signal', () => {
  it('null when there is no manifest — never a guessed default', () => {
    expect(deriveToolNatureReadOnly([{ riskLevel: 'low', mutates: false }], false)).toBeNull()
  })

  it('true when a manifest exists and every tool is provably read-only (mutates===false, low/medium risk)', () => {
    expect(
      deriveToolNatureReadOnly(
        [
          { riskLevel: 'low', mutates: false },
          { riskLevel: 'medium', mutates: false },
        ],
        true
      )
    ).toBe(true)
  })

  it('true (vacuously) for a manifest with zero tools — it can only answer from instructions', () => {
    expect(deriveToolNatureReadOnly([], true)).toBe(true)
  })

  it('false when any tool mutates (explicit mutates===true)', () => {
    expect(
      deriveToolNatureReadOnly([{ riskLevel: 'low', mutates: false }, { riskLevel: 'low', mutates: true }], true)
    ).toBe(false)
  })

  it('false when a tool nature is unproven (mutates absent) — the fail-closed default, never "read-only"', () => {
    // The regression this closes: a read tool persisted without mutates=false
    // (column default true) must NOT read as read-only.
    expect(deriveToolNatureReadOnly([{ riskLevel: 'low' }], true)).toBe(false)
  })

  it('null when a tool has a risk level outside the schema vocabulary (nature unknowable)', () => {
    expect(deriveToolNatureReadOnly([{ riskLevel: 'exotic', mutates: false }], true)).toBeNull()
  })

  it('false when a high/critical-risk tool is mounted (mutating by definition)', () => {
    expect(deriveToolNatureReadOnly([{ riskLevel: 'high', mutates: false }], true)).toBe(false)
  })
})

describe('GET /api/agent-ops/projects/:id/copilots', () => {
  beforeEach(() => {
    Object.assign(process.env, ENV)
    copilotsHandler = () => []
    manifestHandler = () => undefined
    toolsHandler = () => []
    copilotsThrows = null
    timeoutFlag = false
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('the proxy gate refuses a request without a session and without x-amc-key (401)', () => {
    const gated = proxy(new NextRequest(`http://localhost/api/agent-ops/projects/${PROJECT_ID}/copilots`))
    expect(gated.status).toBe(401)
  })

  it('the proxy matcher covers the agent-ops path', () => {
    expect(proxyConfig.matcher).toContain('/api/agent-ops/:path*')
  })

  it('malformed project id -> 400', async () => {
    const res = await GET(req('NOT A VALID ID'), params('NOT A VALID ID'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid id' })
  })

  it('backend not configured -> 503', async () => {
    delete process.env.AMC_SUPABASE_URL
    const res = await GET(req(PROJECT_ID), params(PROJECT_ID))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'live backend not configured' })
    process.env.AMC_SUPABASE_URL = ENV.AMC_SUPABASE_URL
  })

  it('upstream failure at load time -> 502, generic body (no leak)', async () => {
    copilotsThrows = new Error('ECONNREFUSED postgrest.internal role=service_role')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(req(PROJECT_ID), params(PROJECT_ID))
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).not.toContain('service_role')
    expect(JSON.parse(text)).toEqual({ error: 'failed to load copilots' })
    consoleSpy.mockRestore()
  })

  it('PostgREST timeout at load time -> 504', async () => {
    copilotsThrows = new Error('timeout')
    timeoutFlag = true
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(req(PROJECT_ID), params(PROJECT_ID))
    expect(res.status).toBe(504)
    consoleSpy.mockRestore()
  })

  it('a project with zero copilots -> { copilots: [] } (not an error)', async () => {
    copilotsHandler = () => []
    const res = await GET(req(PROJECT_ID), params(PROJECT_ID))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, projectId: PROJECT_ID, copilots: [] })
  })

  it('returns the two known copilots with the corrected shape', async () => {
    const market = copilotFixture()
    const risk = copilotFixture({
      id: RISK_ID,
      name: 'TradeAgent Portfolio Risk Guardian',
      slug: 'tradeagent-portfolio-risk-guardian',
      createdAt: '2026-07-21T02:20:50.786Z',
      updatedAt: '2026-07-21T02:20:50.786Z',
    })
    copilotsHandler = () => [market, risk]
    manifestHandler = (id) => readOnlyManifest(id)
    toolsHandler = () => []

    const res = await GET(req(PROJECT_ID), params(PROJECT_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.copilots).toHaveLength(2)

    for (const entry of body.copilots) {
      // NEW/CORRECTED fields
      expect(entry.status).toBe('draft') // mapped, not promoted
      expect(entry.rawStatus).toBe('draft')
      expect(entry.readOnly).toBe(true) // grounded in the real invariant
      expect(typeof entry.createdAt).toBe('string')
      expect(typeof entry.updatedAt).toBe('string')
      expect(entry.availability).toBe('unavailable') // draft is not offered
      // sanity on unchanged fields
      expect(entry.provider).toBe('openai')
      expect(entry.requiresHumanApproval).toBe(true) // risky-only ≠ never
    }
    const ids = body.copilots.map((c: { id: string }) => c.id)
    expect(ids).toContain(MARKET_ID)
    expect(ids).toContain(RISK_ID)
  })

  it('an active copilot maps to available and is offered', async () => {
    copilotsHandler = () => [copilotFixture({ status: 'active' })]
    manifestHandler = (id) => readOnlyManifest(id)
    const res = await GET(req(PROJECT_ID), params(PROJECT_ID))
    const body = await res.json()
    expect(body.copilots[0].status).toBe('available')
    expect(body.copilots[0].availability).toBe('available')
  })

  it('readOnly is null for a copilot with no manifest', async () => {
    copilotsHandler = () => [copilotFixture()]
    manifestHandler = () => undefined
    const res = await GET(req(PROJECT_ID), params(PROJECT_ID))
    const body = await res.json()
    expect(body.copilots[0].readOnly).toBeNull()
    expect(body.copilots[0].version).toBeNull()
    expect(body.copilots[0].requiresHumanApproval).toBeNull()
  })

  it('readOnly is nature-based: read-only tools → true, a mutating tool → false (single source, matches /runtime/v1)', async () => {
    const toolRow = (name: string, mutates: boolean): ToolDefinition => ({
      id: `tool-${name}`,
      name,
      description: name,
      provider: 'internal',
      riskLevel: 'low',
      enabled: true,
      requiresConfirmation: false,
      mutates,
      scopedRoutes: [],
      lastUsedAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      callsLast7d: 0,
      errorRateLast7d: 0,
    })
    copilotsHandler = () => [copilotFixture()]
    manifestHandler = (id) => readOnlyManifest(id)

    // All read → true
    toolsHandler = () => [toolRow('read_market_snapshot', false), toolRow('read_volatility_state', false)]
    let body = await (await GET(req(PROJECT_ID), params(PROJECT_ID))).json()
    expect(body.copilots[0].readOnly).toBe(true)

    // One mutating tool → false, no matter the manifest prose
    toolsHandler = () => [toolRow('read_market_snapshot', false), toolRow('place_order', true)]
    body = await (await GET(req(PROJECT_ID), params(PROJECT_ID))).json()
    expect(body.copilots[0].readOnly).toBe(false)
  })

  it('never leaks the manifest system prompt into the payload', async () => {
    copilotsHandler = () => [copilotFixture()]
    manifestHandler = (id) => readOnlyManifest(id)
    const res = await GET(req(PROJECT_ID), params(PROJECT_ID))
    const text = await res.text()
    expect(text).not.toContain('INTERNAL — must never ship')
    expect(text).not.toContain('systemPromptSummary')
  })

  it('scopes strictly by project — a copilot of another project is filtered out', async () => {
    copilotsHandler = () => [
      copilotFixture(),
      copilotFixture({ id: 'copilot-other', projectId: OTHER_PROJECT_ID }),
    ]
    manifestHandler = (id) => readOnlyManifest(id)
    const res = await GET(req(PROJECT_ID), params(PROJECT_ID))
    const body = await res.json()
    const ids = body.copilots.map((c: { id: string }) => c.id)
    expect(ids).toContain(MARKET_ID)
    expect(ids).not.toContain('copilot-other')
    expect(JSON.stringify(body)).not.toContain(OTHER_PROJECT_ID)
  })
})
