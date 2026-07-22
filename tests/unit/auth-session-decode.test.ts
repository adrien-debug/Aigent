import { describe, expect, it } from 'vitest'

import { SESSION_COOKIE, createAdminSessionCookie, decodeSession } from '@/lib/agent-mission-control/auth'

/**
 * Non-regression for AIGENT-DEEP-FORENSIC-029 (decodeSession-crash): a
 * length-matching but malformed MAC decoded to a different byte length, and
 * crypto.timingSafeEqual THROWS on mismatched lengths — the uncaught RangeError
 * turned the documented fail-closed `null` into a 500 in the proxy AND preempted
 * the valid x-amc-key fallback. decodeSession must return `null` for any bad
 * cookie, never throw.
 */
function cookieValue(setCookie: string): string {
  // "amc_session=<value>; Path=/; ..." → "<value>"
  return setCookie.slice(`${SESSION_COOKIE}=`.length).split(';')[0]
}

describe('decodeSession — fail-closed, never throws', () => {
  it('accepts a freshly minted valid session cookie', () => {
    const value = cookieValue(createAdminSessionCookie())
    const session = decodeSession(value)
    expect(session).not.toBeNull()
    expect(session?.role).toBe('admin')
  })

  const badCookies: Array<[string, string]> = [
    ['empty', ''],
    ['no dot', 'notacookie'],
    ['dot only', '.'],
    ['payload but no mac', 'abc.'],
    ['garbage mac', 'abc.zzzz'],
    // A MAC that is the right STRING length as the real one but invalid base64
    // content — the shape that used to decode to a mismatched byte length and
    // make timingSafeEqual throw.
    ['length-matching invalid-base64 mac', (() => {
      const real = cookieValue(createAdminSessionCookie())
      const dot = real.lastIndexOf('.')
      const payload = real.slice(0, dot)
      const mac = real.slice(dot + 1)
      // Replace the mac with the same length of clearly-invalid base64 chars.
      return `${payload}.${'@'.repeat(mac.length)}`
    })()],
    ['tampered payload', (() => {
      const real = cookieValue(createAdminSessionCookie())
      return `x${real}`
    })()],
  ]

  for (const [name, value] of badCookies) {
    it(`returns null (no throw) for: ${name}`, () => {
      expect(() => decodeSession(value)).not.toThrow()
      expect(decodeSession(value)).toBeNull()
    })
  }
})
