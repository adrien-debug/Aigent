/**
 * API identity gate — `/api/agent-ops/**` behind session or `x-amc-key`.
 * Admin UI routes were removed in frontend reset; matcher is API-only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/agent-mission-control/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent-mission-control/auth')>()
  return {
    ...actual,
    decodeSession: () => null,
  }
})

let proxy: typeof import('@/proxy').proxy
let config: typeof import('@/proxy').config

beforeAll(async () => {
  vi.stubEnv('AMC_API_KEY', 'test-api-key')
  vi.resetModules()
  const mod = await import('@/proxy')
  proxy = mod.proxy
  config = mod.config
})

afterAll(() => {
  vi.unstubAllEnvs()
})

function request(path: string, headers: Record<string, string> = {}) {
  return {
    url: `https://console.example.com${path}`,
    method: 'GET',
    headers: new Headers(headers),
    cookies: { get: () => undefined },
  } as unknown as Parameters<typeof proxy>[0]
}

function matcherCovers(path: string): boolean {
  return config.matcher.some((pattern) => {
    if (pattern.endsWith('/:path*')) {
      const prefix = pattern.slice(0, -'/:path*'.length)
      return path === prefix || path.startsWith(`${prefix}/`)
    }
    return path === pattern
  })
}

describe('API identity gate — matcher', () => {
  it('runs the proxy on agent-ops API routes', () => {
    expect(matcherCovers('/api/agent-ops/copilots')).toBe(true)
  })

  it('does not run the proxy on removed admin UI routes', () => {
    expect(matcherCovers('/admin')).toBe(false)
    expect(matcherCovers('/admin/runs')).toBe(false)
  })
})

describe('API identity gate — decision', () => {
  it('returns 401 JSON when there is no session and no API key', () => {
    const response = proxy(request('/api/agent-ops/copilots'))
    expect(response.status).toBe(401)
  })

  it('allows agent-ops when x-amc-key matches', () => {
    const response = proxy(request('/api/agent-ops/copilots', { 'x-amc-key': 'test-api-key' }))
    expect(response.status).not.toBe(401)
  })

  it('leaves the root page reachable without auth', () => {
    expect(proxy(request('/')).status).not.toBe(401)
  })

  it('leaves login and auth routes reachable', () => {
    for (const path of ['/login', '/logout', '/api/auth/login']) {
      expect(proxy(request(path)).status).not.toBe(401)
    }
  })
})
