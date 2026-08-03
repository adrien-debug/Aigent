/**
 * API identity gate — `/api/agent-ops/**` behind session or `x-amc-key`.
 *
 * AIGENT-HARDENING-PRODUCTION-001 : le matcher n'est PLUS « API-only ». Il
 * couvre désormais tout ce qui n'est pas explicitement exclu, parce que les
 * pages lisaient PostgREST sans aucune garde. Ce fichier teste toujours la
 * même chose — la DÉCISION prise sur `/api/agent-ops/**` — mais la couverture
 * du matcher se vérifie en exécutant son motif, et non en comparant sa syntaxe
 * à une chaîne littérale. La posture d'une garde ne se lit pas dans la forme
 * du motif.
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

/**
 * Exécute le motif du matcher. Il accepte les deux formes rencontrées dans ce
 * repository : la syntaxe Next `:path*` et une expression régulière brute.
 */
function matcherCovers(path: string): boolean {
  return config.matcher.some((pattern) => {
    if (pattern.endsWith('/:path*')) {
      const prefix = pattern.slice(0, -'/:path*'.length)
      return path === prefix || path.startsWith(`${prefix}/`)
    }
    if (pattern.startsWith('/(') || pattern.includes('(?!')) {
      return new RegExp(`^${pattern}$`).test(path)
    }
    return path === pattern
  })
}

describe('API identity gate — matcher', () => {
  it('runs the proxy on agent-ops API routes', () => {
    expect(matcherCovers('/api/agent-ops/copilots')).toBe(true)
  })

  it('runs the proxy on pages too — elles lisaient PostgREST sans garde', () => {
    expect(matcherCovers('/')).toBe(true)
    expect(matcherCovers('/agents')).toBe(true)
  })

  it('leaves Next static assets out of the matcher', () => {
    expect(matcherCovers('/_next/static/chunk.js')).toBe(false)
    expect(matcherCovers('/favicon.ico')).toBe(false)
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
