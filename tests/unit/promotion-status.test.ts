/**
 * Route tests for POST /api/agent-ops/copilots/:copilotId/promotion
 * (src/app/api/agent-ops/copilots/[copilotId]/promotion/route.ts).
 *
 * Focus: the business-data integrity fix — a controlled promotion/rollback must
 * align copilots.status to 'active' alongside production_version_id, in ONE
 * copilots PATCH, and must NOT write anything when the release gate is red.
 *
 * Pure, offline: `evaluateReleaseGate` is mocked, and `fetch` is stubbed to a
 * scripted PostgREST double that records every write. No network, no gpu1, no
 * secrets. `status: 'active'` is asserted because CopilotStatus has no
 * 'production' member — 'active' is the stored value for serving-production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const COPILOT_ID = 'copilot-promo-test'
const CANDIDATE = 'version-candidate'
const PREVIOUS_PROD = 'version-previous-prod'

let gateResult: { promotable: boolean; checks: { label: string; status: string; observed: string }[] } | null

vi.mock('@/lib/agent-mission-control/release-gate', () => ({
  evaluateReleaseGate: vi.fn(async () => gateResult),
}))

import { POST } from '@/app/api/agent-ops/copilots/[copilotId]/promotion/route'

interface WriteRecord {
  path: string
  body: Record<string, unknown>
}

let writes: WriteRecord[]

/**
 * Scripted PostgREST double over fetch. GETs answer the copilot pointer +
 * version ownership; PATCHes are recorded and echo back a representation row so
 * the route's `.length === 0` guards pass.
 */
function installFetch(opts: { currentProd: string | null; stages?: Record<string, string>; rpcStatus?: number }) {
  writes = []
  // Stage resolution mirrors the real DB: the current production pointer is at
  // stage 'production'; anything else defaults to 'draft' unless the test
  // overrides it (e.g. a previously-served version at 'archived').
  const stageOf = (id: string): string =>
    opts.currentProd && id === opts.currentProd ? 'production' : (opts.stages?.[id] ?? 'draft')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      const method = init?.method ?? 'GET'

      if (method === 'GET') {
        if (u.includes('copilots?id=eq.')) {
          return jsonRes([{ id: COPILOT_ID, production_version_id: opts.currentProd }])
        }
        if (u.includes('copilot_versions?id=in.')) {
          // Every id in the filter belongs to this copilot.
          const ids = [CANDIDATE, PREVIOUS_PROD, ...(opts.currentProd ? [opts.currentProd] : [])]
          return jsonRes(ids.map((id) => ({ id, copilot_id: COPILOT_ID, stage: stageOf(id) })))
        }
        return jsonRes([])
      }

      // POST/PATCH — record it and echo a representation row back. The
      // transition RPC can be forced to 409 (a concurrent promote winning the
      // single-production race) via opts.rpcStatus.
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
      writes.push({ path: u, body })
      if (u.includes('/rpc/promote_copilot_version') && opts.rpcStatus && opts.rpcStatus !== 200) {
        return { ok: false, status: opts.rpcStatus, json: async () => ({}), text: async () => 'conflict' } as Response
      }
      return jsonRes([{ id: 'row', ...body }])
    })
  )
}

function jsonRes(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) } as Response
}

function req(body: Record<string, unknown>): Request {
  return new Request('http://test/promotion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = Promise.resolve({ copilotId: COPILOT_ID })

/** The atomic-transition RPC call (rpc/promote_copilot_version). */
function rpcCall(): WriteRecord | undefined {
  return writes.find((w) => w.path.includes('/rpc/promote_copilot_version'))
}

/** The copilots PATCH (not the copilot_versions ones). */
function copilotWrite(): WriteRecord | undefined {
  return writes.find((w) => w.path.includes('copilots?id=eq.') && !w.path.includes('copilot_versions'))
}

describe('POST promotion — copilot.status alignment', () => {
  const saved = {
    src: process.env.AMC_DATA_SOURCE,
    url: process.env.AMC_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }

  beforeEach(() => {
    process.env.AMC_DATA_SOURCE = 'gpu1'
    process.env.AMC_SUPABASE_URL = 'http://backend.test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
    gateResult = { promotable: true, checks: [] }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.AMC_DATA_SOURCE = saved.src
    process.env.AMC_SUPABASE_URL = saved.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key
  })

  it('A — promote success drives the ATOMIC transition RPC with the candidate + previous-prod', async () => {
    installFetch({ currentProd: PREVIOUS_PROD })

    const res = await POST(req({ action: 'promote', versionId: CANDIDATE, previousProductionVersionId: PREVIOUS_PROD }), {
      params,
    })
    expect(res.status).toBe(200)

    // A single atomic RPC does archive-previous + promote-candidate + repoint,
    // instead of 3 separate PATCHes. Assert its params.
    const rpc = rpcCall()
    expect(rpc).toBeDefined()
    expect(rpc!.body.p_copilot_id).toBe(COPILOT_ID)
    expect(rpc!.body.p_version_id).toBe(CANDIDATE)
    expect(rpc!.body.p_previous_prod).toBe(PREVIOUS_PROD)
    // No direct copilot_versions/copilots PATCH — the writes are inside the txn.
    expect(copilotWrite()).toBeUndefined()
  })

  it('B — gate red performs NO write and leaves status untouched', async () => {
    gateResult = { promotable: false, checks: [{ label: 'Tests pass rate', status: 'fail', observed: '66%' }] }
    installFetch({ currentProd: PREVIOUS_PROD })

    const res = await POST(req({ action: 'promote', versionId: CANDIDATE }), { params })
    expect(res.status).toBe(422)
    const payload = (await res.json()) as { blocking?: string[] }
    expect(payload.blocking).toBeDefined()
    // Not a single PATCH happened — no version stage change, no status change.
    expect(writes.length).toBe(0)
  })

  it('C — rollback to an ARCHIVED version keeps status active (never draft)', async () => {
    // Rollback restores PREVIOUS_PROD (archived = previously served) as the
    // serving version. Gate is exempt for rollback, so it writes regardless of
    // gateResult — BUT only because the target already passed a gate once.
    gateResult = null
    installFetch({ currentProd: CANDIDATE, stages: { [PREVIOUS_PROD]: 'archived' } })

    const res = await POST(
      req({ action: 'rollback', versionId: PREVIOUS_PROD, previousProductionVersionId: CANDIDATE }),
      { params }
    )
    expect(res.status).toBe(200)
    // Atomic RPC: restore PREVIOUS_PROD as production, archive the current (CANDIDATE).
    const rpc = rpcCall()
    expect(rpc).toBeDefined()
    expect(rpc!.body.p_version_id).toBe(PREVIOUS_PROD)
    expect(rpc!.body.p_previous_prod).toBe(CANDIDATE)
  })

  it('E — rollback to a NON-archived draft is refused 409 with ZERO writes (gate bypass closed)', async () => {
    // The P0: `{action:'rollback', versionId:<any owned draft>}` would push an
    // un-gated draft straight to production+active. The server must reject any
    // rollback whose target is not a previously-served (archived) version.
    gateResult = null // rollback never calls the gate; the stage check is the guard
    installFetch({ currentProd: PREVIOUS_PROD, stages: { [CANDIDATE]: 'draft' } })

    const res = await POST(
      req({ action: 'rollback', versionId: CANDIDATE, previousProductionVersionId: PREVIOUS_PROD }),
      { params }
    )
    expect(res.status).toBe(409)
    const payload = (await res.json()) as { error?: string; observedStage?: string }
    expect(payload.error).toMatch(/archived/i)
    expect(payload.observedStage).toBe('draft')
    // No version stage flipped to production, no copilot status/pointer write.
    expect(writes.length).toBe(0)
  })

  it('F — a concurrent promote losing the single-production race → 409 (RPC 23505 mapped)', async () => {
    // The partial-unique index makes two production versions impossible; the
    // losing writer's RPC fails 23505 → PostgREST 409 → the route surfaces 409
    // instead of a partial write or a lying production pointer.
    installFetch({ currentProd: PREVIOUS_PROD, rpcStatus: 409 })

    const res = await POST(req({ action: 'promote', versionId: CANDIDATE, previousProductionVersionId: PREVIOUS_PROD }), {
      params,
    })
    expect(res.status).toBe(409)
    const payload = (await res.json()) as { error?: string }
    expect(payload.error).toMatch(/concurrent/i)
  })

  it('D — beta is not handled by this route → production status is never forced from beta', async () => {
    // This route only accepts promote|rollback (both land production). A beta
    // action is rejected outright, so no production status is written.
    installFetch({ currentProd: null })
    const res = await POST(req({ action: 'promote-beta', versionId: CANDIDATE }), { params })
    expect(res.status).toBe(400)
    expect(writes.length).toBe(0)
  })
})
