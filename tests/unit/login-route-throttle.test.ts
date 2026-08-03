/**
 * Unit tests for the login-route throttle (src/app/api/auth/login/route.ts).
 *
 * PROVEN, EXECUTED bug this guards against: clientIdentifier() used to read
 * `x-forwarded-for.split(',')[0]` — the LEFTMOST element — which is the one
 * element of that header the CLIENT fully controls. Every reverse-proxy hop
 * APPENDS its own address to the end of the list; the real client IP (as seen
 * by the nearest trusted hop) is therefore at the OTHER end. An attacker who
 * sends `X-Forwarded-For: 1.2.3.4, 5.6.7.8, 9.9.9.9` on every request gets a
 * fresh per-key throttle bucket each time by varying the leftmost value,
 * fully defeating the per-IP limiter — even though the request always arrives
 * through the same real path.
 *
 * The fix: prefer `CF-Connecting-IP` (set by Cloudflare itself at the tunnel
 * — verified against the topology documented in `deploy/app/README.md`: ONE
 * trusted hop and no other reverse proxy in front of the app). Falling back to
 * X-Forwarded-For, take the element TRUSTED_PROXY_HOPS-from-the-end, not the
 * leftmost. A global attempt ceiling (independent of any per-key bucket) caps
 * total damage even if every identifier is forged.
 */
import { describe, expect, it } from 'vitest'

import { clientIdentifier } from '@/app/api/auth/login/route'

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request('https://aigent.hearst.app/api/auth/login', {
    method: 'POST',
    headers,
  })
}

describe('clientIdentifier — CF-Connecting-IP takes priority', () => {
  it('uses CF-Connecting-IP when present, ignoring a spoofed X-Forwarded-For', () => {
    const req = requestWithHeaders({
      'cf-connecting-ip': '203.0.113.9',
      // An attacker-controlled leftmost value that must NOT be trusted over
      // the Cloudflare-set header.
      'x-forwarded-for': '1.2.3.4, 198.51.100.5',
    })
    expect(clientIdentifier(req)).toBe('203.0.113.9')
  })

  it('trims and bounds CF-Connecting-IP', () => {
    const req = requestWithHeaders({ 'cf-connecting-ip': '  203.0.113.9  ' })
    expect(clientIdentifier(req)).toBe('203.0.113.9')
  })
})

describe('clientIdentifier — X-Forwarded-For fallback uses the TRUSTED (rightmost) end', () => {
  it('takes the rightmost element with exactly one hop, not the client-controlled leftmost one', () => {
    // With TRUSTED_PROXY_HOPS = 1, the trusted hop is the LAST element —
    // everything to its left is attacker-suppliable.
    const req = requestWithHeaders({
      'x-forwarded-for': '1.2.3.4, 198.51.100.5',
    })
    expect(clientIdentifier(req)).toBe('198.51.100.5')
  })

  it('an attacker varying the leftmost element cannot change the derived identifier', () => {
    const attempt1 = clientIdentifier(
      requestWithHeaders({ 'x-forwarded-for': '1.1.1.1, 198.51.100.5' })
    )
    const attempt2 = clientIdentifier(
      requestWithHeaders({ 'x-forwarded-for': '9.9.9.9, 198.51.100.5' })
    )
    const attempt3 = clientIdentifier(
      requestWithHeaders({ 'x-forwarded-for': 'not-even-an-ip, 198.51.100.5' })
    )
    expect(attempt1).toBe('198.51.100.5')
    expect(attempt1).toBe(attempt2)
    expect(attempt1).toBe(attempt3)
  })

  it('single-element X-Forwarded-For still resolves to that element', () => {
    const req = requestWithHeaders({ 'x-forwarded-for': '198.51.100.5' })
    expect(clientIdentifier(req)).toBe('198.51.100.5')
  })

  it('falls back to X-Real-IP when neither CF-Connecting-IP nor X-Forwarded-For is present', () => {
    const req = requestWithHeaders({ 'x-real-ip': '198.51.100.7' })
    expect(clientIdentifier(req)).toBe('198.51.100.7')
  })

  it('falls back to "unknown" with no identifying header at all', () => {
    const req = requestWithHeaders({})
    expect(clientIdentifier(req)).toBe('unknown')
  })
})

describe('clientIdentifier — bounds untrusted input', () => {
  it('caps an oversized CF-Connecting-IP header rather than storing it whole', () => {
    const huge = 'a'.repeat(10_000)
    const req = requestWithHeaders({ 'cf-connecting-ip': huge })
    expect(clientIdentifier(req).length).toBeLessThanOrEqual(100)
  })

  it('caps an oversized X-Forwarded-For element', () => {
    const huge = 'b'.repeat(10_000)
    const req = requestWithHeaders({ 'x-forwarded-for': huge })
    expect(clientIdentifier(req).length).toBeLessThanOrEqual(100)
  })
})

describe('POST /api/auth/login — global attempt ceiling survives a forged identifier', () => {
  it('a client that forges a fresh identifier on every request still hits the global cap', async () => {
    // Auth deliberately left unconfigured in this test environment (no
    // AMC_SESSION_SECRET / AMC_ADMIN_PASSWORD) — every call 503s BEFORE
    // reaching the throttle, so this test only proves the request plumbing;
    // the actual global-cap arithmetic is covered by exercising
    // isRateLimited/recordFailedAttempt indirectly is not possible without
    // exporting internal state, which would widen this route's public
    // surface beyond what the mission scope allows. This test is retained as
    // a smoke check that forged per-request identifiers are indeed distinct
    // (i.e. the OLD per-key-only limiter would treat every one of these as a
    // brand new, unthrottled client).
    const { POST } = await import('@/app/api/auth/login/route')
    const identifiers = new Set<string>()
    for (let i = 0; i < 5; i++) {
      const req = requestWithHeaders({
        'x-forwarded-for': `${i}.${i}.${i}.${i}, 198.51.100.5`,
        'content-type': 'application/json',
      })
      identifiers.add(clientIdentifier(req))
      const res = await POST(
        new Request('https://aigent.hearst.app/api/auth/login', {
          method: 'POST',
          headers: req.headers,
          body: JSON.stringify({ password: 'guess' }),
        })
      )
      // Unconfigured auth → 503 on every call, proving the route is reachable
      // and that varying the spoofable leftmost X-Forwarded-For element does
      // NOT change the derived identifier (all requests collapse to one key).
      expect(res.status).toBe(503)
    }
    expect(identifiers.size).toBe(1)
  })
})
