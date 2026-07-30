/**
 * Live tests — the operator API answers for an authenticated session.
 *
 * This file used to be `pages.test.ts` and asserted that `/admin`,
 * `/admin/agents` and `/admin/agents/:id` rendered. The frontend reset deleted
 * every one of those routes (`AGENTS.md` § Frontend), so those assertions were
 * guaranteed-red against a correct app — a test suite lying about its subject.
 * They were removed on 2026-07-30; only the API assertion below survived, and
 * the file was renamed to match what it actually tests.
 *
 * `src/proxy.ts` now guards `/api/agent-ops/**` ONLY. A session cookie and an
 * `x-amc-key` header are both accepted there; this suite logs in through the
 * real `/api/auth/login` route with `AMC_ADMIN_PASSWORD`, exactly as a human
 * operator would, and reuses the signed cookie.
 *
 * Opt-in (`npm run test:live`): requires `npm run dev` running and
 * `AMC_ADMIN_PASSWORD` configured. Skips cleanly otherwise.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import { findAppBaseUrl } from './helpers'

let baseUrl: string | null = null
let sessionCookie: string | null = null

beforeAll(async () => {
  baseUrl = await findAppBaseUrl()
  if (!baseUrl) return
  const password = process.env.AMC_ADMIN_PASSWORD
  if (!password) return
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) {
    // Keep just the cookie's name=value pair for the Cookie request header.
    sessionCookie = setCookie.split(';')[0]
  }
})

describe('/api/agent-ops — latest mission for TradeAgent project', () => {
  it('GET /api/agent-ops/projects/proj-tradeagent/missions/latest returns persisted mission', async () => {
    if (!baseUrl || !sessionCookie) {
      console.warn('[live] skip: app not reachable or admin login unavailable')
      return
    }
    const res = await fetch(`${baseUrl}/api/agent-ops/projects/proj-tradeagent/missions/latest`, {
      headers: { Cookie: sessionCookie },
      signal: AbortSignal.timeout(15_000),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok?: boolean
      mission?: { status?: string; report?: { runId?: string; status?: string } } | null
    }
    expect(body.ok).toBe(true)
    if (!body.mission) {
      console.warn('[live] skip: no persisted mission yet for proj-tradeagent')
      return
    }
    expect(body.mission.status).toBe('completed')
    expect(body.mission.report?.runId).toBeTruthy()
    expect(body.mission.report?.status).toBe('completed')
  })
})
