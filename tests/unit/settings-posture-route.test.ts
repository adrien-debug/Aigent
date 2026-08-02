import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))

const getSettingsPostureSnapshot = vi.fn()
vi.mock('@/lib/agent-mission-control/settings-posture', () => ({
  getSettingsPostureSnapshot: () => getSettingsPostureSnapshot(),
}))

const { GET } = await import('@/app/api/agent-ops/settings/posture/route')
const { proxy } = await import('@/proxy')

describe('GET /api/agent-ops/settings/posture', () => {
  beforeEach(() => {
    getSettingsPostureSnapshot.mockReset()
  })

  it('is protected upstream by the /api/agent-ops proxy gate', () => {
    const response = proxy(new NextRequest('http://localhost/api/agent-ops/settings/posture'))
    expect(response.status).toBe(401)
  })

  it('returns the redacted snapshot payload when the collector succeeds', async () => {
    getSettingsPostureSnapshot.mockResolvedValue({
      status: 'partial',
      checkedAt: '2026-08-02T00:00:00.000Z',
      message: 'partial config',
      operatorAuth: { status: 'configured', message: 'ok', provenance: 'auth', endpoint: null },
      backendGpu1: { status: 'configured', message: 'ok', provenance: 'probe', endpoint: 'https://pg.internal' },
      langgraph: { status: 'configured', message: 'ok', provenance: 'env', endpoint: 'http://127.0.0.1:2024' },
      providers: { status: 'partial', message: 'partial', provenance: 'env', items: [] },
      observability: {
        status: 'not_configured',
        message: 'off',
        provenance: 'env',
        langsmith: { status: 'not_configured', message: 'off', provenance: 'env', endpoint: null },
        langfuse: { status: 'not_configured', message: 'off', provenance: 'env', endpoint: null },
      },
      githubShipping: {
        status: 'partial',
        message: 'dry-run',
        provenance: 'env',
        endpoint: 'https://api.github.com',
      },
      learningRuntime: {
        status: 'not_configured',
        message: 'not configured',
        provenance: 'runtime',
        endpoint: null,
        capabilities: null,
      },
    })

    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'partial' })
  })
})
