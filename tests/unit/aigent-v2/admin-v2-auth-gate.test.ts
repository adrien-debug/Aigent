/**
 * AIGENT-FRONTEND-RESET-001 — /admin-v2/** must be behind the SAME session gate
 * as /admin/**.
 *
 * MEASURED REGRESSION THIS PINS (29/07/2026): the identity gate matched
 * `path === '/admin' || path.startsWith('/admin/')`, and `config.matcher` only
 * listed `/admin/:path*`. `/admin-v2/runs` matched neither, so the new console —
 * every agent name, project, input summary and cost in the fleet — answered 200
 * to an anonymous request. Confirmed by curl in both directions before and after
 * the fix.
 *
 * TWO failure modes are pinned here because fixing only one still leaves the
 * hole open:
 *   1. `config.matcher` must cause the proxy to RUN on /admin-v2.
 *   2. `proxy()` must then REFUSE an unauthenticated request.
 *
 * Pure and OFFLINE: no server, no cookie signing — the proxy is called directly
 * with a stubbed request.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/agent-mission-control/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent-mission-control/auth')>()
  return {
    ...actual,
    // No valid session, ever — this suite is about the anonymous case.
    decodeSession: () => null,
  }
})

/**
 * `DEV_AUTH_BYPASS` is a module-level const, so the escape hatch must be
 * decided BEFORE the module is imported. The local `.env.local` turns it on,
 * which would make every assertion below pass for the wrong reason (200
 * because dev waved it through, not because the gate is open). Loading the
 * module with the flag explicitly OFF is what makes this suite test the
 * production behaviour.
 */
let proxy: typeof import('@/proxy').proxy
let config: typeof import('@/proxy').config

beforeAll(async () => {
  vi.stubEnv('AMC_DEV_BYPASS_AUTH', '0')
  vi.resetModules()
  const mod = await import('@/proxy')
  proxy = mod.proxy
  config = mod.config
})

afterAll(() => {
  vi.unstubAllEnvs()
})

/** Minimal NextRequest stand-in: the proxy only reads url, method and cookies. */
function request(path: string) {
  return {
    url: `https://console.example.com${path}`,
    method: 'GET',
    headers: new Headers(),
    cookies: { get: () => undefined },
  } as unknown as Parameters<typeof proxy>[0]
}

/**
 * Mirrors Next.js matcher semantics closely enough for the shapes used here:
 * a literal segment path, or `/:path*` meaning "this prefix followed by /…".
 */
function matcherCovers(path: string): boolean {
  return config.matcher.some((pattern) => {
    if (pattern.endsWith('/:path*')) {
      const prefix = pattern.slice(0, -'/:path*'.length)
      return path === prefix || path.startsWith(`${prefix}/`)
    }
    return path === pattern
  })
}

const V2_PATHS = ['/admin-v2', '/admin-v2/runs', '/admin-v2/runs?status=failed'.split('?')[0]!]

describe('/admin-v2 identity gate — matcher', () => {
  it.each(V2_PATHS)('runs the proxy on %s', (path) => {
    // Guard #1: if the matcher misses, the function body below never executes
    // and the route is public no matter how correct that body is.
    expect(matcherCovers(path)).toBe(true)
  })

  it('still covers the legacy admin surface and the agent-ops API', () => {
    expect(matcherCovers('/admin')).toBe(true)
    expect(matcherCovers('/admin/agents')).toBe(true)
    expect(matcherCovers('/api/agent-ops/copilots')).toBe(true)
  })
})

describe('/admin-v2 identity gate — decision', () => {
  it.each(V2_PATHS)('redirects %s to /login when there is no session', (path) => {
    const response = proxy(request(path))

    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe('/login')
    // The intended destination survives the round trip through login.
    expect(location.searchParams.get('next')).toBe(path)
  })

  it('treats /admin-v2 exactly like /admin — no weaker gate for the new console', () => {
    const legacy = proxy(request('/admin/agents'))
    const v2 = proxy(request('/admin-v2/runs'))

    expect(v2.status).toBe(legacy.status)
  })

  it('does not gate an unrelated route that merely starts with the same letters', () => {
    // `/administration` is not an admin surface; a bare startsWith('/admin')
    // would have swallowed it and redirected a public page to /login.
    expect(matcherCovers('/administration')).toBe(false)
  })

  it('leaves the always-open surfaces reachable', () => {
    for (const path of ['/login', '/logout', '/api/auth/login']) {
      expect(proxy(request(path)).status).not.toBe(307)
    }
  })
})

/**
 * The other direction. A gate that refuses EVERYTHING is not a working gate,
 * it is an outage — so the documented dev escape hatch is probed too. Without
 * this, a change that hard-blocks /admin-v2 would leave the suite green.
 */
describe('/admin-v2 identity gate — dev escape hatch', () => {
  it('lets the local dev bypass through, and only when it is explicitly on', async () => {
    vi.stubEnv('AMC_DEV_BYPASS_AUTH', '1')
    vi.resetModules()
    const withBypass = await import('@/proxy')

    expect(withBypass.proxy(request('/admin-v2/runs')).status).not.toBe(307)

    vi.stubEnv('AMC_DEV_BYPASS_AUTH', '0')
    vi.resetModules()
    const withoutBypass = await import('@/proxy')

    expect(withoutBypass.proxy(request('/admin-v2/runs')).status).toBe(307)
  })
})
