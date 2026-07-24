/**
 * Unit tests for bearer-token-auth.ts
 * (src/lib/agent-mission-control/bearer-token-auth.ts).
 *
 * Security-critical, pure, offline. Covers the two things a token gate must get
 * right: extracting the presented token from the request, and comparing it in
 * constant time (no length/prefix leak). A bug here is an auth bypass or a
 * timing side channel, so the edges are exercised explicitly.
 */
import { describe, expect, it } from 'vitest'

import {
  MAX_TOKEN_LENGTH,
  extractBearerToken,
  timingSafeEqual,
} from '@/lib/agent-mission-control/bearer-token-auth'

function req(headers: Record<string, string>): Request {
  return new Request('https://example.test/api', { headers })
}

describe('extractBearerToken', () => {
  it('reads a well-formed Authorization: Bearer <token>', () => {
    expect(extractBearerToken(req({ authorization: 'Bearer abc123' }))).toBe('abc123')
  })

  it('is case-insensitive on the Bearer scheme and trims surrounding space', () => {
    expect(extractBearerToken(req({ authorization: '  bearer   tok-x  ' }))).toBe('tok-x')
    expect(extractBearerToken(req({ authorization: 'BEARER tok-y' }))).toBe('tok-y')
  })

  it('returns null when there is no Authorization and no fallback header', () => {
    expect(extractBearerToken(req({}))).toBeNull()
  })

  it('returns null for a malformed Authorization (no Bearer scheme)', () => {
    expect(extractBearerToken(req({ authorization: 'Basic abc123' }))).toBeNull()
    expect(extractBearerToken(req({ authorization: 'Bearer' }))).toBeNull()
    expect(extractBearerToken(req({ authorization: 'Bearer    ' }))).toBeNull()
  })

  it('falls back to the surface-specific header only when Authorization is absent/invalid', () => {
    expect(extractBearerToken(req({ 'x-aigent-runtime-token': 'from-header' }), 'x-aigent-runtime-token')).toBe(
      'from-header',
    )
    // Authorization wins over the fallback when it is well-formed.
    expect(
      extractBearerToken(req({ authorization: 'Bearer from-auth', 'x-aigent-runtime-token': 'from-header' }), 'x-aigent-runtime-token'),
    ).toBe('from-auth')
  })

  it('does not read the fallback header when none is named', () => {
    expect(extractBearerToken(req({ 'x-aigent-runtime-token': 'ignored' }))).toBeNull()
  })

  it('length-caps the token to MAX_TOKEN_LENGTH (bounds the later compare)', () => {
    const long = 'a'.repeat(MAX_TOKEN_LENGTH + 50)
    const got = extractBearerToken(req({ authorization: `Bearer ${long}` }))
    expect(got).toHaveLength(MAX_TOKEN_LENGTH)
    // same cap on the fallback-header path
    const gotHeader = extractBearerToken(req({ 'x-tok': long }), 'x-tok')
    expect(gotHeader).toHaveLength(MAX_TOKEN_LENGTH)
  })
})

describe('timingSafeEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqual('s3cret-token', 's3cret-token')).toBe(true)
  })

  it('returns false for different same-length strings', () => {
    expect(timingSafeEqual('aaaaaa', 'aaaaab')).toBe(false)
  })

  it('returns false (fast) when lengths differ — the only early-out allowed', () => {
    expect(timingSafeEqual('short', 'longer-token')).toBe(false)
    expect(timingSafeEqual('', 'x')).toBe(false)
  })

  it('two empty strings compare equal', () => {
    expect(timingSafeEqual('', '')).toBe(true)
  })

  it('a wrong char at the FIRST position is not treated differently from the LAST (no short-circuit)', () => {
    // Both must be false; the point is that the function does not early-return
    // on the first mismatch (that would leak prefix info via timing). We can't
    // measure timing here, but we assert correctness on both mismatch positions.
    expect(timingSafeEqual('Xbcdef', 'abcdef')).toBe(false)
    expect(timingSafeEqual('abcdeX', 'abcdef')).toBe(false)
  })
})
