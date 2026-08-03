import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * AIGENT-RUNTIME-PRODUCTIZATION-001 — tenant isolation across
 * `/api/runtime/v1/**`.
 *
 * Closes the default the mission was written to fix: `AIGENT_RUNTIME_API_TOKEN`
 * used to be a single global token with no identity, so `getPublishedAgents()`
 * returned the WHOLE fleet regardless of caller. These tests pin the fix at the
 * resolution layer (`resolveRuntimeTenant` / `tenantCanSeeProject`,
 * runtime-api-types.ts) and at the one route (`agents/[agentId]/route.ts`) that
 * exercises the full request path end to end.
 *
 * Pure, OFFLINE: `consumer-installations` (the only module that touches
 * PostgREST) is mocked. NO network, NO DB, NO secret.
 */

type InstallationFixture = {
  id: string
  projectId: string | null
  status: 'active' | 'revoked'
}

const installations = new Map<string, InstallationFixture>()

vi.mock('@/lib/agent-mission-control/consumer-installations', () => ({
  authenticateInstallation: vi.fn(async (token: string | null, expectedInstallationId: string) => {
    if (!token) return null
    const fixture = installations.get(expectedInstallationId)
    if (!fixture) return null
    // The fixture's "token" is just its id, prefixed — good enough to exercise
    // the resolution logic without a real hash.
    if (token !== `token-for-${fixture.id}`) return null
    if (fixture.status !== 'active') return null
    return {
      id: fixture.id,
      projectId: fixture.projectId,
      copilotId: 'irrelevant-for-this-test',
      environment: 'production' as const,
      label: null,
      status: fixture.status,
      lastSeenAt: null,
      lastVersionLoaded: null,
      lastVersionLoadedAt: null,
      versionId: null,
      deliveryEventId: null,
      revokedReason: null,
    }
  }),
}))

const { resolveRuntimeTenant, tenantCanSeeProject } = await import(
  '@/lib/agent-mission-control/runtime-api-types'
)

const LEGACY_TOKEN = 'legacy-operator-token-not-a-real-secret'

function reqWithInstallation(installationId: string, token: string): Request {
  return new Request('http://localhost/api/runtime/v1/agents', {
    headers: {
      'x-aigent-installation-id': installationId,
      Authorization: `Bearer ${token}`,
    },
  })
}

function reqWithLegacyToken(token: string): Request {
  return new Request('http://localhost/api/runtime/v1/agents', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  installations.clear()
  installations.set('inst-a', { id: 'inst-a', projectId: 'proj-a', status: 'active' })
  installations.set('inst-b', { id: 'inst-b', projectId: 'proj-b', status: 'active' })
  installations.set('inst-unprovisioned', { id: 'inst-unprovisioned', projectId: null, status: 'active' })
  installations.set('inst-revoked', { id: 'inst-revoked', projectId: 'proj-a', status: 'revoked' })
  process.env.AIGENT_RUNTIME_API_TOKEN = LEGACY_TOKEN
})

describe('resolveRuntimeTenant — installation credential', () => {
  it('resolves tenant A to its own project', async () => {
    const result = await resolveRuntimeTenant(reqWithInstallation('inst-a', 'token-for-inst-a'))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tenant).toEqual({ kind: 'installation', projectId: 'proj-a', installationId: 'inst-a' })
    }
  })

  it('resolves tenant B to its own, DIFFERENT project', async () => {
    const result = await resolveRuntimeTenant(reqWithInstallation('inst-b', 'token-for-inst-b'))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tenant).toEqual({ kind: 'installation', projectId: 'proj-b', installationId: 'inst-b' })
    }
  })

  it("refuses tenant A's token presented against tenant B's installation id", async () => {
    const result = await resolveRuntimeTenant(reqWithInstallation('inst-b', 'token-for-inst-a'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('refuses a revoked installation token', async () => {
    const result = await resolveRuntimeTenant(reqWithInstallation('inst-revoked', 'token-for-inst-revoked'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('refuses an UNPROVISIONED installation (null project_id) — never treated as a wildcard', async () => {
    const result = await resolveRuntimeTenant(reqWithInstallation('inst-unprovisioned', 'token-for-inst-unprovisioned'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('never falls through to the legacy token when an installation id was presented but failed', async () => {
    // Presenting inst-b's id with the legacy token value must NOT authenticate
    // as legacy-unscoped — that would be a downgrade attack from scoped to
    // unscoped access via a single wrong header.
    const result = await resolveRuntimeTenant(reqWithInstallation('inst-b', LEGACY_TOKEN))
    expect(result.ok).toBe(false)
  })
})

describe('resolveRuntimeTenant — legacy shared token (backward compatibility)', () => {
  it('resolves to legacy-unscoped when no installation id header is present', async () => {
    const result = await resolveRuntimeTenant(reqWithLegacyToken(LEGACY_TOKEN))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tenant).toEqual({ kind: 'legacy-unscoped', projectId: null, installationId: null })
    }
  })

  it('still answers 503 when AIGENT_RUNTIME_API_TOKEN is not configured', async () => {
    delete process.env.AIGENT_RUNTIME_API_TOKEN
    const result = await resolveRuntimeTenant(reqWithLegacyToken(LEGACY_TOKEN))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(503)
  })

  it('answers 401 on a wrong legacy token', async () => {
    const result = await resolveRuntimeTenant(reqWithLegacyToken('wrong'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })
})

describe('tenantCanSeeProject', () => {
  it('an installation tenant sees only its own project', () => {
    const tenantA = { kind: 'installation' as const, projectId: 'proj-a', installationId: 'inst-a' }
    expect(tenantCanSeeProject(tenantA, 'proj-a')).toBe(true)
    expect(tenantCanSeeProject(tenantA, 'proj-b')).toBe(false)
  })

  it('a null resource project is never visible to a scoped tenant', () => {
    const tenantA = { kind: 'installation' as const, projectId: 'proj-a', installationId: 'inst-a' }
    expect(tenantCanSeeProject(tenantA, null)).toBe(false)
  })

  it('legacy-unscoped sees every project, including null (fleet-wide, as before this mission)', () => {
    const legacy = { kind: 'legacy-unscoped' as const, projectId: null, installationId: null }
    expect(tenantCanSeeProject(legacy, 'proj-a')).toBe(true)
    expect(tenantCanSeeProject(legacy, 'proj-b')).toBe(true)
    expect(tenantCanSeeProject(legacy, null)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// End-to-end: GET /api/runtime/v1/agents/:agentId — cross-tenant read.
// ---------------------------------------------------------------------------

describe('GET /api/runtime/v1/agents/:agentId — cross-tenant isolation', () => {
  const agentsOfProjectA = new Set(['agent-a-1'])
  const agentsOfProjectB = new Set(['agent-b-1'])

  vi.doMock('@/lib/agent-mission-control/available-agents', () => ({
    getAvailableAgent: vi.fn(async (copilotId: string) => {
      if (agentsOfProjectA.has(copilotId)) {
        return {
          copilotId,
          projectId: 'proj-a',
          name: 'Agent A',
          description: null,
          status: 'active',
          unresolvedToolIds: [],
          unavailableFields: [],
          runtime: 'langgraph',
          provider: 'openai',
          configuredModel: 'gpt-5.4',
          executedModel: null,
          tools: [],
          capabilities: [],
          readOnly: false,
          requiresHumanApproval: false,
          lastRunAt: null,
          lastRunStatus: null,
          lastRunCostUsd: null,
        }
      }
      if (agentsOfProjectB.has(copilotId)) {
        return {
          copilotId,
          projectId: 'proj-b',
          name: 'Agent B',
          description: null,
          status: 'active',
          unresolvedToolIds: [],
          unavailableFields: [],
          runtime: 'langgraph',
          provider: 'openai',
          configuredModel: 'gpt-5.4',
          executedModel: null,
          tools: [],
          capabilities: [],
          readOnly: false,
          requiresHumanApproval: false,
          lastRunAt: null,
          lastRunStatus: null,
          lastRunCostUsd: null,
        }
      }
      return undefined
    }),
    getAvailableAgents: vi.fn(async () => []),
  }))

  vi.doMock('@/lib/agent-mission-control/data', () => ({
    getCopilot: vi.fn(async (id: string) => ({ id, slug: id, runtime: 'langgraph', updatedAt: null })),
  }))

  async function getAgent(request: Request, agentId: string) {
    const mod = await import('@/app/api/runtime/v1/agents/[agentId]/route')
    return mod.GET(request, { params: Promise.resolve({ agentId }) })
  }

  it('tenant A can read its own agent', async () => {
    const res = await getAgent(reqAgent('agent-a-1', 'inst-a', 'token-for-inst-a'), 'agent-a-1')
    expect(res.status).toBe(200)
  })

  it("tenant A cannot read tenant B's agent — 404, indistinguishable from nonexistent", async () => {
    const resForeign = await getAgent(reqAgent('agent-b-1', 'inst-a', 'token-for-inst-a'), 'agent-b-1')
    const resMissing = await getAgent(reqAgent('agent-does-not-exist', 'inst-a', 'token-for-inst-a'), 'agent-does-not-exist')
    expect(resForeign.status).toBe(404)
    expect(resMissing.status).toBe(404)
    expect(await resForeign.json()).toEqual(await resMissing.json())
  })

  it('the legacy unscoped token can still read any agent (no TradeAgent regression)', async () => {
    const res = await getAgent(reqAgentLegacy('agent-b-1'), 'agent-b-1')
    expect(res.status).toBe(200)
  })

  function reqAgent(agentId: string, installationId: string, token: string): Request {
    return new Request(`http://localhost/api/runtime/v1/agents/${agentId}`, {
      headers: {
        'x-aigent-installation-id': installationId,
        Authorization: `Bearer ${token}`,
      },
    })
  }

  function reqAgentLegacy(agentId: string): Request {
    return new Request(`http://localhost/api/runtime/v1/agents/${agentId}`, {
      headers: { Authorization: `Bearer ${LEGACY_TOKEN}` },
    })
  }
})
