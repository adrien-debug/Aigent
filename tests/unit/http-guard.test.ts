/**
 * Unit tests for the SHARED SSRF guard (src/langgraph/http-guard.mjs).
 *
 * This module is the single implementation behind BOTH outbound HTTP readers:
 * `http_get` (src/langgraph/tool-registry.mjs — the tool whose URL an LLM
 * chooses) and HttpMarketProvider (…/market/provider.ts). They used to be two
 * parallel copies that had already drifted: the market copy validated the URL
 * scheme, `http_get` did not. Testing the shared module is therefore the only
 * place a scheme/host/redirect rule needs to be proven — and proving it here
 * proves it for the LLM-driven path too.
 *
 * The contract these tests pin down: the guard NEVER throws. Every refusal,
 * timeout and network error resolves to a typed `{ ok: false, code, reason }`
 * so each caller can map it onto its own shape (a JSON tool result, an
 * UNAVAILABLE provenance) without a try/catch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { guardedFetch, validateHttpUrl, MAX_HTTP_REDIRECTS } from '@/langgraph/http-guard.mjs'

const ALLOWED = ['api.example.com']

/** A non-redirect 200 with a text body. */
function okResponse(body = 'hello') {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => body,
    json: async () => ({ body }),
  }
}

/** A redirect response pointing at `location`. */
function redirectResponse(location: string, status = 302) {
  return {
    ok: false,
    status,
    headers: new Headers({ location }),
    text: async () => '',
    json: async () => ({}),
  }
}

const readText = (res: Response) => res.text()

describe('validateHttpUrl — scheme + host rules', () => {
  it('accepts an http and an https URL on an allowed host', () => {
    for (const raw of ['http://api.example.com/x', 'https://api.example.com/x']) {
      const out = validateHttpUrl(raw, ALLOWED)
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.host).toBe('api.example.com')
    }
  })

  it('refuses a non-http(s) scheme — the hardening that existed on only one copy', () => {
    // These are exactly the schemes an LLM-chosen URL could smuggle through
    // `http_get`, which had NO scheme check before this module existed.
    for (const raw of ['file:///etc/passwd', 'data:text/plain,pwned', 'gopher://api.example.com/', 'ftp://api.example.com/x']) {
      const out = validateHttpUrl(raw, ALLOWED)
      expect(out.ok).toBe(false)
      if (!out.ok) {
        expect(out.code).toBe('disallowed-scheme')
        expect(out.reason).toMatch(/scheme must be http or https/i)
      }
    }
  })

  it('reports a bad scheme as a SCHEME problem even when the host is empty', () => {
    // A scheme-blind guard would say "host not allowed" for file:// (empty
    // host), which sends whoever reads the log hunting the wrong rule.
    const out = validateHttpUrl('file:///etc/passwd', ALLOWED)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('disallowed-scheme')
  })

  it('refuses a host outside the allowlist', () => {
    const out = validateHttpUrl('https://169.254.169.254/latest/meta-data/', ALLOWED)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.code).toBe('host-not-allowed')
      expect(out.host).toBe('169.254.169.254')
    }
  })

  it('treats an EMPTY allowlist as "nothing allowed", not "no restriction"', () => {
    const out = validateHttpUrl('https://api.example.com/x', [])
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('host-not-allowed')
  })

  it('checks the scheme only when allowedHosts is null (config-validation mode)', () => {
    // How HttpMarketProvider validates its configured base URL: the pin is
    // DERIVED from the accepted URL, so there is no list to check it against.
    const ok = validateHttpUrl('https://tradeagent.example.com')
    expect(ok.ok).toBe(true)
    const bad = validateHttpUrl('file:///etc/passwd')
    expect(bad.ok).toBe(false)
  })

  it('refuses an unparseable URL', () => {
    const out = validateHttpUrl('not a url at all', ALLOWED)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.code).toBe('invalid-url')
      expect(out.reason).toMatch(/not a parseable absolute URL/i)
    }
  })

  it('a port makes a DIFFERENT host — a pin is host:port, not hostname', () => {
    // Matching on hostname alone would let an allowed name reach an internal
    // admin port on the same box.
    const out = validateHttpUrl('https://api.example.com:8080/x', ALLOWED)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('host-not-allowed')
  })
})

describe('guardedFetch — refusals never open a socket', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('refuses a non-http(s) scheme WITHOUT calling fetch', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const out = await guardedFetch('file:///etc/passwd', {
      allowedHosts: ALLOWED,
      timeoutMs: 1000,
      readBody: readText,
    })

    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('disallowed-scheme')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a host outside the allowlist WITHOUT calling fetch', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const out = await guardedFetch('http://169.254.169.254/latest/meta-data/', {
      allowedHosts: ALLOWED,
      timeoutMs: 1000,
      readBody: readText,
    })

    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('host-not-allowed')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('guardedFetch — redirects are walked by hand and re-validated', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('disables auto-redirect (auto-follow would only ever check the FIRST host)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse())
    global.fetch = fetchMock as unknown as typeof fetch

    await guardedFetch('https://api.example.com/x', {
      allowedHosts: ALLOWED,
      timeoutMs: 1000,
      readBody: readText,
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.redirect).toBe('manual')
    expect(init.cache).toBe('no-store')
  })

  it('follows a redirect that stays on an allowed host', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse('https://api.example.com/x?v=2'))
      .mockResolvedValueOnce(okResponse('second hop'))
    global.fetch = fetchMock as unknown as typeof fetch

    const out = await guardedFetch('https://api.example.com/x', {
      allowedHosts: ALLOWED,
      timeoutMs: 1000,
      readBody: readText,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.body).toBe('second hop')
      expect(out.finalUrl).toBe('https://api.example.com/x?v=2')
    }
  })

  it('follows a RELATIVE redirect resolved against the current hop', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse('/moved'))
      .mockResolvedValueOnce(okResponse('relative ok'))
    global.fetch = fetchMock as unknown as typeof fetch

    const out = await guardedFetch('https://api.example.com/x', {
      allowedHosts: ALLOWED,
      timeoutMs: 1000,
      readBody: readText,
    })

    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.example.com/moved')
    expect(out.ok).toBe(true)
  })

  it('blocks a redirect to a disallowed host AT THAT HOP — the hop is never fetched', async () => {
    // The attack the manual walk exists for: an ALLOWED host 302s to cloud
    // metadata. Auto-redirect would have fetched it.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse('http://169.254.169.254/latest/meta-data/'))
    global.fetch = fetchMock as unknown as typeof fetch

    const out = await guardedFetch('https://api.example.com/x', {
      allowedHosts: ALLOWED,
      timeoutMs: 1000,
      readBody: readText,
    })

    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.code).toBe('redirect-host-not-allowed')
      expect(out.reason).toMatch(/redirect to disallowed host/i)
      expect(out.reason).toMatch(/169\.254\.169\.254/)
    }
    // Exactly one socket: the disallowed hop was never followed.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('blocks a disallowed host on the SECOND hop, not just the first', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse('https://api.example.com/step2'))
      .mockResolvedValueOnce(redirectResponse('http://10.0.0.1/admin'))
    global.fetch = fetchMock as unknown as typeof fetch

    const out = await guardedFetch('https://api.example.com/x', {
      allowedHosts: ALLOWED,
      timeoutMs: 1000,
      readBody: readText,
    })

    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('redirect-host-not-allowed')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('blocks a redirect that switches to a non-http(s) scheme', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(redirectResponse('file:///etc/passwd'))
    global.fetch = fetchMock as unknown as typeof fetch

    const out = await guardedFetch('https://api.example.com/x', {
      allowedHosts: ALLOWED,
      timeoutMs: 1000,
      readBody: readText,
    })

    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('redirect-disallowed-scheme')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('gives up after too many hops instead of looping forever', async () => {
    const fetchMock = vi.fn().mockResolvedValue(redirectResponse('https://api.example.com/loop'))
    global.fetch = fetchMock as unknown as typeof fetch

    const out = await guardedFetch('https://api.example.com/x', {
      allowedHosts: ALLOWED,
      timeoutMs: 1000,
      readBody: readText,
    })

    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.code).toBe('too-many-redirects')
      expect(out.reason).toMatch(/too many redirects/i)
    }
    expect(fetchMock).toHaveBeenCalledTimes(MAX_HTTP_REDIRECTS)
  })
})

describe('guardedFetch — failures are returned, never thrown', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('a network throw from fetch resolves to a typed rejection', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch

    const out = await guardedFetch('https://api.example.com/x', {
      allowedHosts: ALLOWED,
      timeoutMs: 1000,
      readBody: readText,
    })

    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.code).toBe('network-error')
      expect(out.reason).toBe('ECONNREFUSED')
    }
  })

  it('an abort resolves to a timeout rejection, not a throw', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    global.fetch = vi.fn().mockRejectedValue(abortError) as unknown as typeof fetch

    const out = await guardedFetch('https://api.example.com/x', {
      allowedHosts: ALLOWED,
      timeoutMs: 250,
      readBody: readText,
    })

    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.code).toBe('timeout')
      expect(out.reason).toMatch(/timeout after 250ms/i)
    }
  })

  it('a body that fails to parse is caught too — readBody runs INSIDE the guard', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => {
        throw new Error('Unexpected token < in JSON')
      },
    }) as unknown as typeof fetch

    const out = await guardedFetch('https://api.example.com/x', {
      allowedHosts: ALLOWED,
      timeoutMs: 1000,
      readBody: (res) => res.json(),
    })

    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('network-error')
  })

  it('reports a non-2xx status WITHOUT judging it — callers differ on that', async () => {
    // `http_get` wants the body of a 404; the market provider treats any
    // non-2xx as UNAVAILABLE. The guard reports, the caller decides.
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
      text: async () => 'not found',
    }) as unknown as typeof fetch

    const out = await guardedFetch('https://api.example.com/x', {
      allowedHosts: ALLOWED,
      timeoutMs: 1000,
      readBody: readText,
    })

    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.status).toBe(404)
      expect(out.httpOk).toBe(false)
      expect(out.body).toBe('not found')
    }
  })
})
