/**
 * Agent Mission Control — admin session auth (server only).
 *
 * V1 single-admin identity gate. No auth provider, no DB, no heavy dep — a
 * signed session cookie built from `node:crypto` HMAC. Fail-closed IN
 * PRODUCTION: if the required secrets are absent the app cannot mint or
 * trust any session, so every gate denies. In development, both the session
 * secret and the admin password fall back to a hardcoded value (see
 * DEV_FALLBACK_* below) so `npm run dev` always logs in locally even if
 * .env.local wasn't loaded — this fallback is inert whenever
 * NODE_ENV === 'production'.
 *
 * Env (server-side only, NEVER sent to the browser):
 *   AMC_SESSION_SECRET  — HMAC key that signs the session cookie. REQUIRED in
 *                         prod; optional in dev (hardcoded fallback).
 *   AMC_ADMIN_PASSWORD  — the admin password checked at login (plain). Either
 *                         this or AMC_ADMIN_PASSWORD_HASH must be set in
 *                         prod; optional in dev (hardcoded fallback).
 *   AMC_ADMIN_PASSWORD_HASH — optional sha256 hex of the password; preferred
 *                         over the plain var. If both set, the hash wins.
 *   AMC_API_KEY         — optional server-to-server key (unchanged; the proxy
 *                         still accepts x-amc-key for automation).
 *
 * The cookie is `httpOnly`, `sameSite=lax`, `secure` in production, signed and
 * expiring. No JWT-unsigned, no localStorage, no client session.
 */
import 'server-only'

import { createHmac, timingSafeEqual, createHash } from 'node:crypto'

export const SESSION_COOKIE = 'amc_session'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours

// DEV-ONLY hardcoded fallback so `npm run dev` never fails closed just
// because .env.local wasn't loaded (wrong cwd, shell didn't export it, a
// stray process started without it, etc). NEVER used when
// NODE_ENV === 'production' — prod always requires the real env vars.
// Password matches the .env.local default (hearst-agent-mc-2026) so both
// paths log in with the same password.
const DEV_FALLBACK_SESSION_SECRET = 'aigent-local-dev-session-secret-hearst-2026'
const DEV_FALLBACK_ADMIN_PASSWORD = 'Admin'

function isDev(): boolean {
  return process.env.NODE_ENV !== 'production'
}

export interface AdminSession {
  sub: 'admin'
  role: 'admin'
  issuedAt: number
  expiresAt: number
}

/** The signing secret. Dev: hardcoded fallback if unset. Prod: throws if unset (fail-closed). */
function sessionSecret(): string {
  const s = process.env.AMC_SESSION_SECRET
  if (s && s.length >= 16) return s
  if (isDev()) return DEV_FALLBACK_SESSION_SECRET
  throw new Error('AMC_SESSION_SECRET is not configured (min 16 chars) — auth is fail-closed.')
}

/** True when the auth layer is fully configured (secret + a password source). Always true in dev. */
export function authConfigured(): boolean {
  if (isDev()) return true
  const hasSecret = Boolean(process.env.AMC_SESSION_SECRET && process.env.AMC_SESSION_SECRET.length >= 16)
  const hasPassword = Boolean(process.env.AMC_ADMIN_PASSWORD || process.env.AMC_ADMIN_PASSWORD_HASH)
  return hasSecret && hasPassword
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function sign(payloadB64: string): string {
  return b64url(createHmac('sha256', sessionSecret()).update(payloadB64).digest())
}

/** Constant-time string compare (both sides hashed to equal length first). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

/**
 * Verify a login password against AMC_ADMIN_PASSWORD_HASH (sha256 hex) or
 * AMC_ADMIN_PASSWORD (plain), constant-time. In dev, falls back to the
 * hardcoded DEV_FALLBACK_ADMIN_PASSWORD when neither env var is set. In
 * prod, false if neither is configured (fail-closed).
 */
export async function verifyAdminPassword(password: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length === 0) return false
  const hash = process.env.AMC_ADMIN_PASSWORD_HASH
  if (hash) {
    const got = createHash('sha256').update(password).digest('hex')
    return safeEqual(got, hash.trim().toLowerCase())
  }
  const plain = process.env.AMC_ADMIN_PASSWORD
  if (plain) return safeEqual(password, plain)
  if (isDev()) return safeEqual(password, DEV_FALLBACK_ADMIN_PASSWORD)
  return false // fail-closed: no password source configured
}

/** Serialize + sign a fresh admin session into a cookie value. */
function encodeSession(session: AdminSession): string {
  const payload = b64url(Buffer.from(JSON.stringify(session)))
  return `${payload}.${sign(payload)}`
}

/** Parse + verify a cookie value; null if malformed, tampered, or expired. */
export function decodeSession(value: string | undefined | null): AdminSession | null {
  if (!value) return null
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return null
  const payload = value.slice(0, dot)
  const mac = value.slice(dot + 1)

  // Verify signature in constant time before trusting any bytes. The whole
  // verification is wrapped: fromB64url on a malformed MAC can decode to a
  // different byte length than `expected`, and crypto.timingSafeEqual THROWS a
  // RangeError on mismatched lengths. That throw was previously uncaught, so a
  // crafted cookie turned the fail-closed `null` into a 500 — and, worse, the
  // crash in the proxy preempted the valid x-amc-key fallback. Any failure here
  // is "not a valid session" → null, never an exception.
  try {
    const expected = sign(payload)
    if (mac.length !== expected.length || !timingSafeEqual(fromB64url(mac), fromB64url(expected))) {
      return null
    }
  } catch {
    return null // secret missing, malformed MAC, or length mismatch → untrusted
  }
  try {
    const session = JSON.parse(fromB64url(payload).toString('utf8')) as AdminSession
    if (session.sub !== 'admin' || session.role !== 'admin') return null
    if (typeof session.expiresAt !== 'number' || Date.now() >= session.expiresAt) return null
    return session
  } catch {
    return null
  }
}

/** Build a new signed session cookie string (Set-Cookie value). */
export function createAdminSessionCookie(): string {
  const now = Date.now()
  const session: AdminSession = {
    sub: 'admin',
    role: 'admin',
    issuedAt: now,
    expiresAt: now + SESSION_TTL_MS,
  }
  return cookieString(encodeSession(session), Math.floor(SESSION_TTL_MS / 1000))
}

/** Build the cookie that clears the session (Max-Age=0). */
export function clearAdminSessionCookie(): string {
  return cookieString('', 0)
}

function cookieString(value: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`
}

