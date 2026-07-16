/**
 * Live tests — admin pages render (200) for an authenticated session.
 *
 * proxy.ts protects /admin/** by SESSION COOKIE only (not x-amc-key — that's
 * for /api/agent-ops/** automation). This suite logs in via the real
 * /api/auth/login route with AMC_ADMIN_PASSWORD (from .env.local, same as a
 * human operator would use), captures the signed session cookie, and reuses
 * it for each page request.
 *
 * Opt-in (`npm run test:live`): requires `npm run dev` running and
 * AMC_ADMIN_PASSWORD configured. Skips cleanly otherwise.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import { findAppBaseUrl, findRepoScopedLangGraphCopilot } from './helpers'

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

describe('/admin pages — 200 with a valid admin session', () => {
  it('GET /admin (dashboard) — delivery command center', async () => {
    if (!baseUrl || !sessionCookie) {
      console.warn('[live] skip: app not reachable or admin login unavailable (AMC_ADMIN_PASSWORD not set)')
      return
    }
    const res = await fetch(`${baseUrl}/admin`, {
      headers: { Cookie: sessionCookie },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Agent Delivery Command Center')
    expect(html).toContain('Active Delivery Loop')
    expect(html).toContain('Requires Attention')
    expect(html).toContain('Agent Delivery Matrix')
    expect(html).not.toContain('System Topology')
    expect(html).not.toContain('RunLatencyChart')
  })

  it('GET /admin/agents (list)', async () => {
    if (!baseUrl || !sessionCookie) {
      console.warn('[live] skip: app not reachable or admin login unavailable')
      return
    }
    const res = await fetch(`${baseUrl}/admin/agents`, {
      headers: { Cookie: sessionCookie },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    expect(res.status).toBe(200)
  })

  it('GET /admin/agents/:id (detail page for a real copilot)', async () => {
    if (!baseUrl || !sessionCookie) {
      console.warn('[live] skip: app not reachable or admin login unavailable')
      return
    }
    const copilot = await findRepoScopedLangGraphCopilot()
    if (!copilot) {
      console.warn('[live] skip: no live copilot found to build a detail-page URL from')
      return
    }
    const res = await fetch(`${baseUrl}/admin/agents/${copilot.id}`, {
      headers: { Cookie: sessionCookie },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    expect(res.status).toBe(200)
  })
})

describe('/admin pages — without a session, redirect to /login', () => {
  it('GET /admin with no cookie redirects (3xx) rather than rendering', async () => {
    if (!baseUrl) {
      console.warn('[live] skip: app not reachable')
      return
    }
    const res = await fetch(`${baseUrl}/admin`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
  })
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
