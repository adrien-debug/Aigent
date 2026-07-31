import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  SESSION_COOKIE,
  authConfigured,
  createAdminSessionCookie,
  decodeSession,
  verifyAdminPassword,
} from '@/lib/agent-mission-control/auth'

/**
 * Auth is fail-closed in EVERY environment (mission D1). The dev-only fallback
 * pair — a hardcoded session secret and a hardcoded 'Admin' password, reachable
 * whenever NODE_ENV was merely unset — has been removed. These tests pin the
 * removal: without real env vars, nothing can be minted, nothing is trusted,
 * and no password is accepted.
 */
const AUTH_VARS = ['AMC_SESSION_SECRET', 'AMC_ADMIN_PASSWORD', 'AMC_ADMIN_PASSWORD_HASH'] as const
const VALID_SECRET = 'a'.repeat(32)

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = {}
  for (const key of AUTH_VARS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of AUTH_VARS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe('session secret is required — no fallback', () => {
  it('throws when AMC_SESSION_SECRET is absent, even with NODE_ENV unset', () => {
    expect(() => createAdminSessionCookie()).toThrow(/AMC_SESSION_SECRET/)
  })

  it('throws when AMC_SESSION_SECRET is shorter than 16 chars', () => {
    process.env.AMC_SESSION_SECRET = 'tooshort'
    expect(() => createAdminSessionCookie()).toThrow(/AMC_SESSION_SECRET/)
  })

  it('signs and verifies a round-trip session with a valid secret', () => {
    process.env.AMC_SESSION_SECRET = VALID_SECRET
    const setCookie = createAdminSessionCookie()
    const value = setCookie.slice(`${SESSION_COOKIE}=`.length).split(';')[0]
    const session = decodeSession(value)
    expect(session?.role).toBe('admin')
    expect(session?.sub).toBe('admin')
  })

  it('refuses a cookie minted under a different secret', () => {
    process.env.AMC_SESSION_SECRET = VALID_SECRET
    const value = createAdminSessionCookie().slice(`${SESSION_COOKIE}=`.length).split(';')[0]
    process.env.AMC_SESSION_SECRET = 'b'.repeat(32)
    expect(decodeSession(value)).toBeNull()
  })

  it('decodeSession returns null (never throws) when the secret is missing', () => {
    expect(() => decodeSession('abc.def')).not.toThrow()
    expect(decodeSession('abc.def')).toBeNull()
  })
})

describe('authConfigured reflects reality', () => {
  it('is false with no secret and no password', () => {
    expect(authConfigured()).toBe(false)
  })

  it('is false with a valid secret but no password source', () => {
    process.env.AMC_SESSION_SECRET = VALID_SECRET
    expect(authConfigured()).toBe(false)
  })

  it('is false with a password but a too-short secret', () => {
    process.env.AMC_SESSION_SECRET = 'tooshort'
    process.env.AMC_ADMIN_PASSWORD = 'hunter2'
    expect(authConfigured()).toBe(false)
  })

  it('is true only with a valid secret and a password source', () => {
    process.env.AMC_SESSION_SECRET = VALID_SECRET
    process.env.AMC_ADMIN_PASSWORD = 'hunter2'
    expect(authConfigured()).toBe(true)
  })

  it('accepts the hash var as the password source', () => {
    process.env.AMC_SESSION_SECRET = VALID_SECRET
    process.env.AMC_ADMIN_PASSWORD_HASH = 'f'.repeat(64)
    expect(authConfigured()).toBe(true)
  })
})

describe('verifyAdminPassword — no fallback password', () => {
  it('refuses everything when no password source is configured', async () => {
    await expect(verifyAdminPassword('Admin')).resolves.toBe(false)
    await expect(verifyAdminPassword('anything')).resolves.toBe(false)
    await expect(verifyAdminPassword('')).resolves.toBe(false)
  })

  it('accepts the configured plain password and rejects others', async () => {
    process.env.AMC_ADMIN_PASSWORD = 'correct-horse'
    await expect(verifyAdminPassword('correct-horse')).resolves.toBe(true)
    await expect(verifyAdminPassword('Admin')).resolves.toBe(false)
  })

  it('prefers the hash over the plain var', async () => {
    const { createHash } = await import('node:crypto')
    process.env.AMC_ADMIN_PASSWORD = 'plain-one'
    process.env.AMC_ADMIN_PASSWORD_HASH = createHash('sha256').update('hashed-one').digest('hex')
    await expect(verifyAdminPassword('hashed-one')).resolves.toBe(true)
    await expect(verifyAdminPassword('plain-one')).resolves.toBe(false)
  })
})
