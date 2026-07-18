/**
 * Unit tests for the project-team relations WRITE path:
 *  - POST   /api/agent-ops/projects/:id/relations
 *    (src/app/api/agent-ops/projects/[id]/relations/route.ts)
 *  - DELETE /api/agent-ops/projects/:id/relations/:relationId
 *    (src/app/api/agent-ops/projects/[id]/relations/[relationId]/route.ts)
 *  - the shared logic in
 *    src/lib/agent-mission-control/project-team/relations-write.ts
 *
 * Pure and offline: `postgrest` is PARTIALLY mocked (only `pgrest` and
 * `isPgrestTimeout` are faked — `camelRows`, `pgrestDetail` and `PgrestError`
 * stay REAL, same discipline as project-team-route.test.ts, because the
 * 23505 → 409 classification depends on the real `pgrestDetail`/`PgrestError`
 * behavior). `@/lib/agent-mission-control/data` (`getProject`) is fully
 * mocked — no other export from it is used by the code under test.
 *
 * The security-critical assertions are the point of this file: an endpoint
 * belonging to another project must be refused BEFORE any insert is
 * attempted, and a DELETE must never be reachable by id alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type PgrestCall = { method: string; path: string; body?: unknown }

let pgrestCalls: PgrestCall[] = []
type PgrestHandler = (method: string, path: string, body?: unknown) => unknown
let pgrestHandler: PgrestHandler = () => []
let timeoutFlag = false

vi.mock('@/lib/agent-mission-control/postgrest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent-mission-control/postgrest')>()
  return {
    ...actual,
    pgrest: vi.fn(async (method: string, path: string, body?: unknown) => {
      pgrestCalls.push({ method, path, body })
      return pgrestHandler(method, path, body)
    }),
    isPgrestTimeout: (err: unknown) => (timeoutFlag ? true : actual.isPgrestTimeout(err)),
  }
})

type GetProjectHandler = (id: string) => unknown
let getProjectHandler: GetProjectHandler = () => ({ id: 'proj-tradeagent', name: 'TradeAgent' })

vi.mock('@/lib/agent-mission-control/data', () => ({
  getProject: vi.fn(async (id: string) => getProjectHandler(id)),
}))

import { PgrestError } from '@/lib/agent-mission-control/postgrest'

import { DELETE } from '@/app/api/agent-ops/projects/[id]/relations/[relationId]/route'
import { POST } from '@/app/api/agent-ops/projects/[id]/relations/route'

const PROJECT_ID = 'proj-tradeagent'
const OTHER_PROJECT_ID = 'proj-bull21'
const SOURCE_ID = 'copilot-atlas'
const TARGET_ID = 'copilot-sentinel'
const RELATION_ID = '11111111-1111-4111-8111-111111111111'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function postReq(id: string, body: unknown): Request {
  return new Request(`http://localhost/api/agent-ops/projects/${id}/relations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function deleteReq(id: string, relationId: string): Request {
  return new Request(`http://localhost/api/agent-ops/projects/${id}/relations/${relationId}`, {
    method: 'DELETE',
  })
}

function postParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function deleteParams(id: string, relationId: string) {
  return { params: Promise.resolve({ id, relationId }) }
}

const validBody = {
  sourceCopilotId: SOURCE_ID,
  targetCopilotId: TARGET_ID,
  relationType: 'orchestrates' as const,
}

/** Both endpoints resolve as copilots of PROJECT_ID. */
function copilotsBothInProject() {
  return [
    { id: SOURCE_ID, project_id: PROJECT_ID },
    { id: TARGET_ID, project_id: PROJECT_ID },
  ]
}

describe('project-team relations write path', () => {
  const original = {
    source: process.env.AMC_DATA_SOURCE,
    url: process.env.AMC_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }

  beforeEach(() => {
    process.env.AMC_DATA_SOURCE = 'gpu1'
    process.env.AMC_SUPABASE_URL = 'http://127.0.0.1:3999'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
    pgrestCalls = []
    timeoutFlag = false
    getProjectHandler = () => ({ id: PROJECT_ID, name: 'TradeAgent' })
    pgrestHandler = (method, path) => {
      if (method === 'GET' && path.startsWith('copilots')) return copilotsBothInProject()
      if (method === 'POST' && path === 'project_agent_relations') return [{ id: 'ignored' }]
      if (method === 'DELETE' && path.startsWith('project_agent_relations')) return [{ id: RELATION_ID }]
      return []
    }
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

  // ---------------------------------------------------------------------
  // POST — id / body validation
  // ---------------------------------------------------------------------

  it('1 — malformed project id -> 400', async () => {
    const res = await POST(postReq('NOT A VALID ID', validBody), postParams('NOT A VALID ID'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid id' })
  })

  it('2 — missing required field -> 400', async () => {
    const { relationType: _drop, ...withoutType } = validBody
    const res = await POST(postReq(PROJECT_ID, withoutType), postParams(PROJECT_ID))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('invalid body')
  })

  it('3 — unknown relationType (a DERIVED kind, not storable) -> 400', async () => {
    const res = await POST(
      postReq(PROJECT_ID, { ...validBody, relationType: 'project-membership' }),
      postParams(PROJECT_ID)
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('invalid body')
  })

  it('4 — oversized label -> 400', async () => {
    const res = await POST(
      postReq(PROJECT_ID, { ...validBody, label: 'x'.repeat(201) }),
      postParams(PROJECT_ID)
    )
    expect(res.status).toBe(400)
  })

  it('5 — source === target (self-edge) -> 400, DB CHECK never relied upon', async () => {
    const res = await POST(
      postReq(PROJECT_ID, { ...validBody, targetCopilotId: SOURCE_ID }),
      postParams(PROJECT_ID)
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('self-edge')
    // Rejected before any endpoint lookup or insert was ever attempted.
    expect(pgrestCalls.length).toBe(0)
  })

  it('6 — a body-smuggled projectId is rejected by .strict(), never silently accepted', async () => {
    const res = await POST(
      postReq(PROJECT_ID, { ...validBody, projectId: OTHER_PROJECT_ID }),
      postParams(PROJECT_ID)
    )
    expect(res.status).toBe(400)
    expect(pgrestCalls.some((c) => c.method === 'POST' && c.path === 'project_agent_relations')).toBe(false)
  })

  it('7 — env not configured -> 503', async () => {
    delete process.env.AMC_SUPABASE_URL
    const res = await POST(postReq(PROJECT_ID, validBody), postParams(PROJECT_ID))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'live backend not configured' })
  })

  it('8 — unknown project -> 404', async () => {
    getProjectHandler = () => undefined
    const res = await POST(postReq(PROJECT_ID, validBody), postParams(PROJECT_ID))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'project not found' })
  })

  // ---------------------------------------------------------------------
  // POST — THE cross-project write guard
  // ---------------------------------------------------------------------

  it('9 — an endpoint belonging to ANOTHER project -> 422, and NO insert is ever attempted', async () => {
    pgrestHandler = (method, path) => {
      if (method === 'GET' && path.startsWith('copilots')) {
        return [
          { id: SOURCE_ID, project_id: PROJECT_ID },
          { id: TARGET_ID, project_id: OTHER_PROJECT_ID }, // wrong project
        ]
      }
      return []
    }
    const res = await POST(postReq(PROJECT_ID, validBody), postParams(PROJECT_ID))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain(TARGET_ID)
    // The security assertion: the insert path must never have been reached.
    expect(pgrestCalls.some((c) => c.method === 'POST' && c.path === 'project_agent_relations')).toBe(false)
  })

  it('10 — an endpoint that does not exist at all -> 422', async () => {
    pgrestHandler = (method, path) => {
      if (method === 'GET' && path.startsWith('copilots')) {
        // Only the source resolves; the target id is unknown to copilots at all.
        return [{ id: SOURCE_ID, project_id: PROJECT_ID }]
      }
      return []
    }
    const res = await POST(postReq(PROJECT_ID, validBody), postParams(PROJECT_ID))
    expect(res.status).toBe(422)
    expect(pgrestCalls.some((c) => c.method === 'POST' && c.path === 'project_agent_relations')).toBe(false)
  })

  it('11 — the ownership check is ONE batched query, not two round trips', async () => {
    let copilotGetCount = 0
    pgrestHandler = (method, path) => {
      if (method === 'GET' && path.startsWith('copilots')) {
        copilotGetCount += 1
        return copilotsBothInProject()
      }
      if (method === 'POST' && path === 'project_agent_relations') return [{ id: 'ignored' }]
      return []
    }
    const res = await POST(postReq(PROJECT_ID, validBody), postParams(PROJECT_ID))
    expect(res.status).toBe(201)
    expect(copilotGetCount).toBe(1)
  })

  // ---------------------------------------------------------------------
  // POST — happy path, id/project provenance
  // ---------------------------------------------------------------------

  it('12 — happy path: row inserted, project_id comes from the PATH, relationId is a UUID, status is 201 (F10 — creation, not 200)', async () => {
    let insertedBody: Record<string, unknown> | undefined
    pgrestHandler = (method, path, body) => {
      if (method === 'GET' && path.startsWith('copilots')) return copilotsBothInProject()
      if (method === 'POST' && path === 'project_agent_relations') {
        insertedBody = body as Record<string, unknown>
        return [{ id: 'ignored' }]
      }
      return []
    }
    const res = await POST(postReq(PROJECT_ID, validBody), postParams(PROJECT_ID))
    expect(res.status).toBe(201)
    const responseBody = await res.json()
    expect(responseBody.ok).toBe(true)
    expect(UUID_RE.test(responseBody.relationId)).toBe(true)

    expect(insertedBody).toBeDefined()
    expect(insertedBody?.project_id).toBe(PROJECT_ID)
    expect(insertedBody?.source_copilot_id).toBe(SOURCE_ID)
    expect(insertedBody?.target_copilot_id).toBe(TARGET_ID)
    expect(insertedBody?.relation_type).toBe('orchestrates')
    expect(insertedBody?.is_active).toBe(true)
    expect(insertedBody?.id).toBe(responseBody.relationId)
  })

  // ---------------------------------------------------------------------
  // POST — upstream failure classification
  // ---------------------------------------------------------------------

  it('13 — duplicate relation (unique violation 23505) -> 409, no raw detail leaked', async () => {
    pgrestHandler = (method, path) => {
      if (method === 'GET' && path.startsWith('copilots')) return copilotsBothInProject()
      if (method === 'POST' && path === 'project_agent_relations') {
        throw new PgrestError(409, 'POST', 'project_agent_relations', '{"code":"23505","message":"duplicate key"}')
      }
      return []
    }
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(postReq(PROJECT_ID, validBody), postParams(PROJECT_ID))
    expect(res.status).toBe(409)
    const text = await res.text()
    expect(text).not.toContain('23505')
    expect(text).not.toContain('duplicate key')
    expect(JSON.parse(text)).toEqual({ error: 'this relation already exists' })
    consoleSpy.mockRestore()
  })

  it('14 — PostgREST timeout on insert -> 504', async () => {
    pgrestHandler = (method, path) => {
      if (method === 'GET' && path.startsWith('copilots')) return copilotsBothInProject()
      if (method === 'POST' && path === 'project_agent_relations') {
        throw new PgrestError(504, 'POST', 'project_agent_relations', 'request timed out after 30000ms')
      }
      return []
    }
    timeoutFlag = true
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(postReq(PROJECT_ID, validBody), postParams(PROJECT_ID))
    expect(res.status).toBe(504)
    consoleSpy.mockRestore()
  })

  it('15 — other upstream failure on insert -> 502, generic body, no leak', async () => {
    const secret = 'ECONNREFUSED postgrest.internal:5432 role=service_role'
    pgrestHandler = (method, path) => {
      if (method === 'GET' && path.startsWith('copilots')) return copilotsBothInProject()
      if (method === 'POST' && path === 'project_agent_relations') {
        throw new Error(secret)
      }
      return []
    }
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(postReq(PROJECT_ID, validBody), postParams(PROJECT_ID))
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).not.toContain(secret)
    expect(text).not.toContain('service_role')
    expect(JSON.parse(text)).toEqual({ error: 'relation creation failed' })
    consoleSpy.mockRestore()
  })

  it('16 — endpoint verification failure (upstream error) -> 502, no leak', async () => {
    const secret = 'internal schema detail xyz'
    pgrestHandler = (method, path) => {
      if (method === 'GET' && path.startsWith('copilots')) throw new Error(secret)
      return []
    }
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(postReq(PROJECT_ID, validBody), postParams(PROJECT_ID))
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).not.toContain(secret)
    consoleSpy.mockRestore()
  })

  // ---------------------------------------------------------------------
  // F8 — a 23503 foreign-key violation on insert (an endpoint copilot was
  // deleted in the race window between verifyRelationEndpoints and the
  // insert) is a client-actionable 422, never the generic 502 a
  // server-fault code would wrongly imply. The classifier is also
  // whitespace-tolerant, so a pretty-printed PostgREST error body doesn't
  // silently fall through to 502/409 either.
  // ---------------------------------------------------------------------

  it('16a — F8: 23503 foreign-key violation on insert -> 422, raw PostgREST detail never leaked', async () => {
    pgrestHandler = (method, path) => {
      if (method === 'GET' && path.startsWith('copilots')) return copilotsBothInProject()
      if (method === 'POST' && path === 'project_agent_relations') {
        throw new PgrestError(
          409,
          'POST',
          'project_agent_relations',
          '{"code":"23503","message":"insert or update on table \\"project_agent_relations\\" violates foreign key constraint","detail":"Key (target_copilot_id)=(copilot-sentinel) is not present in table \\"copilots\\"."}'
        )
      }
      return []
    }
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(postReq(PROJECT_ID, validBody), postParams(PROJECT_ID))
    expect(res.status).toBe(422)
    const text = await res.text()
    expect(text).not.toContain('23503')
    expect(text).not.toContain('foreign key')
    expect(text).not.toContain('copilot-sentinel')
    expect(JSON.parse(text)).toEqual({ error: 'one of the agents in this relation no longer exists' })
    consoleSpy.mockRestore()
  })

  it('16b — F8: a pretty-printed 23505 body ("code": "23505", whitespace after colon) is still classified as a duplicate -> 409', async () => {
    pgrestHandler = (method, path) => {
      if (method === 'GET' && path.startsWith('copilots')) return copilotsBothInProject()
      if (method === 'POST' && path === 'project_agent_relations') {
        throw new PgrestError(
          409,
          'POST',
          'project_agent_relations',
          '{\n  "code": "23505",\n  "message": "duplicate key value violates unique constraint"\n}'
        )
      }
      return []
    }
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(postReq(PROJECT_ID, validBody), postParams(PROJECT_ID))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'this relation already exists' })
    consoleSpy.mockRestore()
  })

  // ---------------------------------------------------------------------
  // F9 — a blank label is treated as absent (never reaches the DB as `''`,
  // which would degrade the accessible name / render as a visibly empty
  // label); a null byte in the label is rejected explicitly with a clean
  // 400 rather than left to fail at Postgres as an opaque 502.
  // ---------------------------------------------------------------------

  it('F9a — a whitespace-only label is normalized to absent: 201, and the row is inserted with label=null, not label=""', async () => {
    let insertedBody: Record<string, unknown> | undefined
    pgrestHandler = (method, path, body) => {
      if (method === 'GET' && path.startsWith('copilots')) return copilotsBothInProject()
      if (method === 'POST' && path === 'project_agent_relations') {
        insertedBody = body as Record<string, unknown>
        return [{ id: 'ignored' }]
      }
      return []
    }
    const res = await POST(postReq(PROJECT_ID, { ...validBody, label: '   ' }), postParams(PROJECT_ID))
    expect(res.status).toBe(201)
    expect(insertedBody?.label).toBeNull()
  })

  it('F9b — an empty-string label is normalized to absent the same way', async () => {
    let insertedBody: Record<string, unknown> | undefined
    pgrestHandler = (method, path, body) => {
      if (method === 'GET' && path.startsWith('copilots')) return copilotsBothInProject()
      if (method === 'POST' && path === 'project_agent_relations') {
        insertedBody = body as Record<string, unknown>
        return [{ id: 'ignored' }]
      }
      return []
    }
    const res = await POST(postReq(PROJECT_ID, { ...validBody, label: '' }), postParams(PROJECT_ID))
    expect(res.status).toBe(201)
    expect(insertedBody?.label).toBeNull()
  })

  it('F9c — a label containing a null byte -> 400, handled deliberately (not a generic 502 from a DB-level 22021)', async () => {
    const res = await POST(
      postReq(PROJECT_ID, { ...validBody, label: 'bad\0label' }),
      postParams(PROJECT_ID)
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('null byte')
    // No PostgREST call was ever attempted — rejected by the schema up front.
    expect(pgrestCalls.length).toBe(0)
  })

  // ---------------------------------------------------------------------
  // DELETE
  // ---------------------------------------------------------------------

  it('17 — malformed project id -> 400', async () => {
    const res = await DELETE(deleteReq('NOT A VALID ID', RELATION_ID), deleteParams('NOT A VALID ID', RELATION_ID))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid id' })
  })

  it('18 — malformed relationId -> 400', async () => {
    const res = await DELETE(deleteReq(PROJECT_ID, 'not-a-uuid'), deleteParams(PROJECT_ID, 'not-a-uuid'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid relationId' })
  })

  it('19 — env not configured -> 503', async () => {
    delete process.env.AMC_SUPABASE_URL
    const res = await DELETE(deleteReq(PROJECT_ID, RELATION_ID), deleteParams(PROJECT_ID, RELATION_ID))
    expect(res.status).toBe(503)
  })

  it('20 — the delete query is scoped by BOTH id=eq. and project_id=eq. (cross-project delete guard)', async () => {
    let deletePath: string | undefined
    pgrestHandler = (method, path) => {
      if (method === 'DELETE') {
        deletePath = path
        return [{ id: RELATION_ID }]
      }
      return []
    }
    const res = await DELETE(deleteReq(PROJECT_ID, RELATION_ID), deleteParams(PROJECT_ID, RELATION_ID))
    expect(res.status).toBe(200)
    expect(deletePath).toBeDefined()
    expect(deletePath).toContain(`id=eq.${RELATION_ID}`)
    expect(deletePath).toContain(`project_id=eq.${PROJECT_ID}`)
  })

  it('21 — DELETE matching nothing (unknown id, or an id from another project) -> 404', async () => {
    pgrestHandler = (method) => (method === 'DELETE' ? [] : [])
    const res = await DELETE(deleteReq(PROJECT_ID, RELATION_ID), deleteParams(PROJECT_ID, RELATION_ID))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'relation not found' })
  })

  it('22 — DELETE happy path -> 200', async () => {
    pgrestHandler = (method) => (method === 'DELETE' ? [{ id: RELATION_ID }] : [])
    const res = await DELETE(deleteReq(PROJECT_ID, RELATION_ID), deleteParams(PROJECT_ID, RELATION_ID))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('23 — DELETE timeout -> 504', async () => {
    pgrestHandler = () => {
      throw new PgrestError(504, 'DELETE', 'project_agent_relations', 'request timed out after 30000ms')
    }
    timeoutFlag = true
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await DELETE(deleteReq(PROJECT_ID, RELATION_ID), deleteParams(PROJECT_ID, RELATION_ID))
    expect(res.status).toBe(504)
    consoleSpy.mockRestore()
  })

  it('24 — DELETE other upstream failure -> 502, no leak', async () => {
    const secret = 'pg_internal_detail_should_never_ship'
    pgrestHandler = () => {
      throw new Error(secret)
    }
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await DELETE(deleteReq(PROJECT_ID, RELATION_ID), deleteParams(PROJECT_ID, RELATION_ID))
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).not.toContain(secret)
    expect(JSON.parse(text)).toEqual({ error: 'delete failed' })
    consoleSpy.mockRestore()
  })
})
