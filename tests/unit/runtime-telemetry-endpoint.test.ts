/**
 * Unit tests for POST /api/runtime-telemetry
 * (src/app/api/runtime-telemetry/route.ts).
 *
 * Pure, offline: pgrest is mocked — no network, no gpu1 backend, no secrets.
 * Covers auth (Bearer token), payload validation, size cap, secret-pattern
 * rejection, success paths, and the no-leak guarantee on 500s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const FIXTURE_TOKEN = 'test-runtime-telemetry-token-fixture'

type PgrestHandler = (method: string, path: string, body?: unknown) => unknown

let pgrestHandler: PgrestHandler = () => [{ ok: true }]

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async (method: string, path: string, body?: unknown) => pgrestHandler(method, path, body)),
  isPgrestTimeout: () => false,
}))

import { POST } from '@/app/api/runtime-telemetry/route'

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/runtime-telemetry', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function authHeaders(token = FIXTURE_TOKEN): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}

const validEvent = {
  eventId: 'evt_1',
  projectId: 'project-1',
  agentId: 'agent-1',
  runId: 'run-1',
  timestamp: '2026-07-16T00:00:00.000Z',
  status: 'completed' as const,
}

describe('POST /api/runtime-telemetry', () => {
  const originalToken = process.env.AIGENT_RUNTIME_TELEMETRY_TOKEN

  beforeEach(() => {
    process.env.AIGENT_RUNTIME_TELEMETRY_TOKEN = FIXTURE_TOKEN
    pgrestHandler = () => [{ ok: true }]
  })

  afterEach(() => {
    if (originalToken === undefined) delete process.env.AIGENT_RUNTIME_TELEMETRY_TOKEN
    else process.env.AIGENT_RUNTIME_TELEMETRY_TOKEN = originalToken
    vi.restoreAllMocks()
  })

  it('1 — rejects missing token -> 401', async () => {
    const res = await POST(req(validEvent))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'unauthorized' })
  })

  it('2 — rejects invalid token -> 401', async () => {
    const res = await POST(req(validEvent, authHeaders('wrong-token')))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'unauthorized' })
  })

  it('3 — rejects missing projectId/agentId/runId/status -> 400', async () => {
    const cases = [
      { ...validEvent, projectId: undefined },
      { ...validEvent, agentId: undefined },
      { ...validEvent, runId: undefined },
      { ...validEvent, status: undefined },
    ]
    for (const badEvent of cases) {
      const res = await POST(req(badEvent, authHeaders()))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body).toEqual({ error: 'invalid payload' })
    }
  })

  it('4 — rejects oversized payload -> 413', async () => {
    const oversized = { ...validEvent, model: 'x'.repeat(20 * 1024) }
    const res = await POST(req(oversized, authHeaders()))
    expect(res.status).toBe(413)
    const body = await res.json()
    expect(body).toEqual({ error: 'payload too large' })
  })

  it('5 — rejects payload containing an obvious secret pattern -> 400', async () => {
    const withSecret = { ...validEvent, model: `sk-${'a'.repeat(20)}` }
    const res = await POST(req(withSecret, authHeaders()))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toEqual({ error: 'payload rejected: suspicious content' })
  })

  it('6 — accepts a valid completed event -> 202', async () => {
    let insertedPath: string | undefined
    let insertedBody: unknown
    pgrestHandler = (_method, path, body) => {
      insertedPath = path
      insertedBody = body
      return [{ ok: true }]
    }

    const res = await POST(req(validEvent, authHeaders()))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    expect(insertedPath).toBe('runtime_telemetry_events')
    expect((insertedBody as Record<string, unknown>).status).toBe('completed')
  })

  it('7 — accepts a failed event with error.messageHash only (no raw message) -> 202', async () => {
    const failedEvent = {
      ...validEvent,
      status: 'failed' as const,
      error: { messageHash: 'a'.repeat(16), category: 'provider_error' as const },
    }
    const res = await POST(req(failedEvent, authHeaders()))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })

  it('8 — never leaks a stack trace or the raw mock error message on a simulated 500', async () => {
    const rawErrorMessage = 'ECONNREFUSED super-secret-internal-detail at postgrest.internal:5432'
    pgrestHandler = () => {
      const err = new Error(rawErrorMessage)
      err.stack = `Error: ${rawErrorMessage}\n    at pgrestHandler (/some/internal/path.ts:123:45)`
      throw err
    }
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(req(validEvent, authHeaders()))
    expect(res.status).toBe(500)
    const bodyText = await res.text()
    expect(bodyText).not.toContain(rawErrorMessage)
    expect(bodyText).not.toContain('super-secret-internal-detail')
    expect(bodyText).not.toContain('at pgrestHandler')
    expect(bodyText).not.toMatch(/\.ts:\d+:\d+/)
    expect(JSON.parse(bodyText)).toEqual({ error: 'internal error' })

    consoleSpy.mockRestore()
  })
})
