/**
 * Unit tests for GET /api/agent-ops/projects/:id/team
 * (src/app/api/agent-ops/projects/[id]/team/route.ts) and the identity gate
 * that fronts it (src/proxy.ts).
 *
 * Pure and offline: postgrest and the project-team data layer are mocked at
 * top level — no network, no gpu1, no secrets. The zod contract
 * (project-team/schema.ts) is deliberately NOT mocked: half the point of these
 * tests is that the REAL contract is what decides whether a payload ships.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type GraphHandler = (projectId: string) => unknown

let graphHandler: GraphHandler = () => null
let timeoutFlag = false

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async () => []),
  isPgrestTimeout: () => timeoutFlag,
}))

// PARTIAL mock: only the graph load is faked. `isProjectId` stays REAL, because
// the point of sharing it is that the route and the /team page validate ids
// identically — a stubbed copy here would pass while the real guard drifted.
vi.mock('@/lib/agent-mission-control/project-team/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent-mission-control/project-team/data')>()
  return {
    ...actual,
    getProjectTeamGraph: vi.fn(async (projectId: string) => graphHandler(projectId)),
  }
})

import { NextRequest } from 'next/server'

import { GET } from '@/app/api/agent-ops/projects/[id]/team/route'
import type { ProjectTeamGraph } from '@/lib/agent-mission-control/project-team/types'
import { proxy, config as proxyConfig } from '@/proxy'

const PROJECT_ID = 'proj-tradeagent'
const OTHER_PROJECT_ID = 'proj-bull21'

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

function req(id: string): Request {
  return new Request(`http://localhost/api/agent-ops/projects/${id}/team`, { method: 'GET' })
}

/**
 * A graph shaped like the live data: one project hub + two agents of THIS
 * project, one derived edge. Every field is a real column-backed value — there
 * is no invented relation and no fabricated metric here.
 */
function graphFixture(): ProjectTeamGraph {
  return {
    project: { id: PROJECT_ID, name: 'TradeAgent' },
    generatedAt: '2026-07-18T09:00:00.000Z',
    freshness: {
      source: 'LIVE' as const,
      latestActivityAt: '2026-07-18T08:51:00.000Z',
      latestActivityState: 'known' as const,
    },
    summary: {
      totalAgents: 2,
      activeAgents: 1,
      waitingAgents: 0,
      blockedAgents: 1,
      failedAgents: 0,
      draftAgents: 0,
      unavailableAgents: 0,
      runsToday: 12,
    },
    nodes: [
      {
        id: PROJECT_ID,
        kind: 'project' as const,
        name: 'TradeAgent',
        slug: 'tradeagent',
        role: null,
        description: 'ETH-only trading workspace',
        team: null,
        runtime: null,
        model: null,
        status: 'active' as const,
        latestRun: null,
        runHistory: 'not-applicable' as const,
        metrics: { totalRuns: 12, runsToday: 12, successRate: 1 },
        tools: [],
        toolsUnavailable: false,
        href: `/admin/projects/${PROJECT_ID}`,
      },
      {
        id: 'copilot-atlas',
        kind: 'agent' as const,
        name: 'Atlas',
        slug: 'atlas',
        role: null,
        description: 'Reads market structure snapshots.',
        team: 'Trading',
        runtime: 'langgraph',
        model: 'gpt-4.1',
        status: 'active' as const,
        latestRun: {
          id: 'run-1',
          status: 'completed' as const,
          startedAt: '2026-07-18T08:50:00.000Z',
          completedAt: '2026-07-18T08:51:00.000Z',
          costUsd: 0.0142,
          latencyMs: 60_000,
        },
        runHistory: 'known' as const,
        metrics: { totalRuns: 12, runsToday: 12, successRate: 1 },
        tools: [{ id: 'tool-1', name: 'read_recent_runs' }],
        toolsUnavailable: false,
        href: '/admin/agents/copilot-atlas',
      },
      {
        id: 'copilot-sentinel',
        kind: 'agent' as const,
        name: 'Sentinel',
        slug: 'sentinel',
        role: null,
        description: 'Terminal BLOCKED gate.',
        team: 'Trading',
        runtime: 'openai-assistants',
        model: 'gpt-4.1-mini',
        status: 'blocked' as const,
        latestRun: null,
        runHistory: 'known' as const,
        metrics: { totalRuns: 0, runsToday: 0, successRate: null },
        tools: [],
        toolsUnavailable: false,
        href: '/admin/agents/copilot-sentinel',
      },
    ],
    edges: [
      {
        id: `${PROJECT_ID}->copilot-atlas`,
        source: PROJECT_ID,
        target: 'copilot-atlas',
        relation: 'project-membership' as const,
        origin: 'explicit' as const,
        label: 'Member of project',
        active: true,
        lastActivityAt: '2026-07-18T08:51:00.000Z',
        weight: 1,
      },
    ],
  }
}

describe('GET /api/agent-ops/projects/:id/team', () => {
  const original = {
    source: process.env.AMC_DATA_SOURCE,
    url: process.env.AMC_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }

  beforeEach(() => {
    process.env.AMC_DATA_SOURCE = 'gpu1'
    process.env.AMC_SUPABASE_URL = 'http://127.0.0.1:3999'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
    graphHandler = () => null
    timeoutFlag = false
  })

  afterEach(() => {
    if (original.source === undefined) delete process.env.AMC_DATA_SOURCE
    else process.env.AMC_DATA_SOURCE = original.source
    if (original.url === undefined) delete process.env.AMC_SUPABASE_URL
    else process.env.AMC_SUPABASE_URL = original.url
    if (original.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = original.key
    vi.restoreAllMocks()
  })

  it('1 — a request without a session and without x-amc-key is refused 401 by the gate', () => {
    // The route has no gate of its own on purpose: /api/agent-ops/** is fronted
    // by src/proxy.ts. Assert the gate really covers THIS path.
    const gated = proxy(new NextRequest(`http://localhost/api/agent-ops/projects/${PROJECT_ID}/team`))
    expect(gated.status).toBe(401)
  })

  it('2 — the proxy matcher covers the team route path', () => {
    expect(proxyConfig.matcher).toContain('/api/agent-ops/:path*')
  })

  it('3 — malformed project id -> 400', async () => {
    const res = await GET(req('NOT A VALID ID'), params('NOT A VALID ID'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid id' })
  })

  it('4 — unknown project -> 404', async () => {
    graphHandler = () => null
    const res = await GET(req('proj-does-not-exist'), params('proj-does-not-exist'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'project not found' })
  })

  it('5 — backend not configured -> 503', async () => {
    delete process.env.AMC_SUPABASE_URL
    const res = await GET(req(PROJECT_ID), params(PROJECT_ID))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'live backend not configured' })
  })

  it('6 — live backend fails at request time -> 502 (NOT 503), generic body, no leak', async () => {
    // House convention (postgrest.ts, repo/intelligence/route.ts:71-72, and the
    // siblings [id]/route.ts:52 + missions/route.ts:73): a request-time upstream
    // failure is 502. 503 is RESERVED for "not configured" — test 5 — so that a
    // 503 always means "deployment incomplete" and never "the DB fell over".
    const secret = 'ECONNREFUSED postgrest.internal:5432 role=service_role'
    graphHandler = () => {
      throw new Error(secret)
    }
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(req(PROJECT_ID), params(PROJECT_ID))
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).not.toContain(secret)
    expect(text).not.toContain('service_role')
    expect(text).not.toMatch(/\.ts:\d+:\d+/)
    expect(JSON.parse(text)).toEqual({ error: 'team graph unavailable' })
    consoleSpy.mockRestore()
  })

  it('7 — PostgREST timeout -> 504', async () => {
    timeoutFlag = true
    graphHandler = () => {
      throw new Error('timeout')
    }
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(req(PROJECT_ID), params(PROJECT_ID))
    expect(res.status).toBe(504)
    expect(await res.json()).toEqual({ error: 'team graph timed out' })
    consoleSpy.mockRestore()
  })

  it('8 — a real project graph satisfies the zod contract and ships 200', async () => {
    graphHandler = () => graphFixture()
    const res = await GET(req(PROJECT_ID), params(PROJECT_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.nodes)).toBe(true)
    expect(body.nodes.length).toBe(3)
    expect(Array.isArray(body.edges)).toBe(true)
  })

  it('9 — a payload that violates the contract is refused (500 — OUR bug), never shipped', async () => {
    // Not 502/503: the client was fine and the backend answered. We built a
    // payload that breaks our own schema. Reporting that as a backend problem
    // sends operators to check a healthy service.
    graphHandler = () => ({ nodes: 'not-an-array', edges: null, project: null })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(req(PROJECT_ID), params(PROJECT_ID))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'team graph unavailable' })
    consoleSpy.mockRestore()
  })

  it('12 — the three failure modes are distinguishable by status code', async () => {
    // The whole point of the convention: an operator reads the code and knows
    // where to look. Collapsing them onto 503 destroys that signal.
    delete process.env.AMC_SUPABASE_URL
    expect((await GET(req(PROJECT_ID), params(PROJECT_ID))).status).toBe(503) // not configured

    process.env.AMC_SUPABASE_URL = 'http://127.0.0.1:3999'
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    graphHandler = () => {
      throw new Error('upstream down')
    }
    expect((await GET(req(PROJECT_ID), params(PROJECT_ID))).status).toBe(502) // backend broke

    timeoutFlag = true
    expect((await GET(req(PROJECT_ID), params(PROJECT_ID))).status).toBe(504) // backend too slow
    timeoutFlag = false

    graphHandler = () => ({ nodes: 'not-an-array' })
    expect((await GET(req(PROJECT_ID), params(PROJECT_ID))).status).toBe(500) // our bug

    consoleSpy.mockRestore()
  })

  it('13 — an unknown metric count ships as null, never as a fabricated 0', async () => {
    // The contract must be able to CARRY "we do not know". If the schema
    // rejected null here, the data layer would have no honest value to send and
    // an unread count would arrive as an indistinguishable 0.
    graphHandler = () => {
      const graph = graphFixture()
      graph.nodes[2].metrics = { totalRuns: null, runsToday: null, successRate: null }
      graph.summary.runsToday = null
      return graph
    }
    const res = await GET(req(PROJECT_ID), params(PROJECT_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    const sentinel = body.nodes.find((n: { id: string }) => n.id === 'copilot-sentinel')
    expect(sentinel.metrics.totalRuns).toBeNull()
    expect(sentinel.metrics.runsToday).toBeNull()
    expect(body.summary.runsToday).toBeNull()
  })

  it('10 — the route ships no agent belonging to another project', async () => {
    // The data layer is asked for exactly one project, and the route adds
    // nothing to what it returns: no second source, no merge, no "related
    // projects" widening.
    graphHandler = (projectId) => {
      expect(projectId).toBe(PROJECT_ID)
      return graphFixture()
    }
    const res = await GET(req(PROJECT_ID), params(PROJECT_ID))
    const body = await res.json()
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain(OTHER_PROJECT_ID)
    for (const node of body.nodes) {
      if (node.kind === 'project') expect(node.id).toBe(PROJECT_ID)
    }
  })

  it('11 — sensitive fields never reach the payload', async () => {
    // A data-layer regression that smuggles a system prompt / token into a node
    // must not survive the contract check. The node schema is `.strict()`, so an
    // unknown key does not merely get stripped — it fails the whole payload and
    // the route ships nothing at all. Either way the secret never leaves.
    graphHandler = () => {
      const graph = graphFixture()
      // Smuggle the extra keys by construction rather than by casting the typed
      // node — the point is a payload the CONTRACT has never seen.
      return {
        ...graph,
        nodes: graph.nodes.map((node, index) =>
          index === 1
            ? {
                ...node,
                systemPromptSummary: 'You are Atlas. Internal instructions: NEVER SHIP THIS.',
                assistantId: 'asst_secret_value',
                apiKey: 'sk-should-never-ship',
              }
            : node
        ),
      }
    }
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(req(PROJECT_ID), params(PROJECT_ID))
    const text = await res.text()
    expect(text).not.toContain('NEVER SHIP THIS')
    expect(text).not.toContain('systemPromptSummary')
    expect(text).not.toContain('asst_secret_value')
    expect(text).not.toContain('sk-should-never-ship')
    consoleSpy.mockRestore()
  })
})
