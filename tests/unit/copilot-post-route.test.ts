/**
 * Unit tests for POST /api/agent-ops/copilots validation guards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from '@/app/api/agent-ops/copilots/route'

const ENV = {
  AMC_DATA_SOURCE: 'gpu1',
  AMC_SUPABASE_URL: 'https://gpu1.example/rest',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
}

function minimalCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test Agent',
    slug: 'test-agent',
    runtime: 'langgraph',
    model: 'gpt-4o-mini',
    modelProvider: 'openai',
    owner: 'ops',
    manifest: {
      confirmationPolicy: 'risky-only',
      outputContract: { format: 'markdown' },
      proposedTools: [],
      maxStepsPerRun: 10,
      maxCostPerRunUsd: 1,
    },
    ...overrides,
  }
}

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/agent-ops/copilots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

describe('POST /api/agent-ops/copilots', () => {
  beforeEach(() => {
    Object.assign(process.env, ENV)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.AMC_DATA_SOURCE
    delete process.env.AMC_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  it('rejects mistral as modelProvider', async () => {
    const res = await post(minimalCreateBody({ modelProvider: 'mistral' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/modelProvider/i)
  })

  it('rejects an invalid projectId', async () => {
    const res = await post(minimalCreateBody({ projectId: 'INVALID!' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'projectId must be a string or null' })
  })

  it('rejects malformed targetProjectIds entries', async () => {
    const res = await post(minimalCreateBody({ targetProjectIds: ['NOT_A_REAL_ID'] }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'targetProjectIds must be an array of at most 2 strings' })
  })

  it('returns 503 when the live backend is not configured', async () => {
    delete process.env.AMC_DATA_SOURCE

    const res = await post(minimalCreateBody())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'live backend not configured' })
  })
})
