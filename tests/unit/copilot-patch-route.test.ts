/**
 * Unit tests for PATCH /api/agent-ops/copilots/:copilotId validation guards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/agent-mission-control/langgraph-assistants', () => ({
  ensureCopilotAssistant: vi.fn(),
}))

import { PATCH } from '@/app/api/agent-ops/copilots/[copilotId]/route'

const ENV = {
  AMC_DATA_SOURCE: 'gpu1',
  AMC_SUPABASE_URL: 'https://gpu1.example/rest',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
}

function patch(copilotId: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/agent-ops/copilots/${copilotId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ copilotId }) }
  )
}

describe('PATCH /api/agent-ops/copilots/:copilotId', () => {
  beforeEach(() => {
    Object.assign(process.env, ENV)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects an invalid copilotId path param', async () => {
    const res = await patch('INVALID_ID!', { targetProjectIds: [] })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid copilotId' })
  })

  it('rejects malformed targetProjectIds entries', async () => {
    const res = await patch('copilot-test', { targetProjectIds: ['NOT_A_REAL_ID'] })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'targetProjectIds: invalid project id' })
  })

  it('persists valid targetProjectIds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [{ id: 'copilot-test' }],
      }))
    )

    const res = await patch('copilot-test', { targetProjectIds: ['proj-console'] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, persisted: true })

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ target_project_ids: ['proj-console'] })
  })
})
