/**
 * Agent Mission Control — admin session auth (server only).
 *
 * V1 single-admin identity gate. No auth provider, no DB, no heavy dep — a
 * signed session cookie built from `node:crypto` HMAC. Fail-closed in EVERY
 * environment: there is no hardcoded fallback secret and no fallback admin
 * password, in dev no more than in prod. If the env vars are absent the app
 * cannot mint or trust any session, so every gate denies. (Historically a
 * DEV_FALLBACK_* pair made a session forgeable by anyone who read this file
 * whenever NODE_ENV was unset — removed deliberately, do not reintroduce.)
 *
 * Env (server-side only, NEVER sent to the browser):
 *   AMC_SESSION_SECRET  — HMAC key that signs the session cookie. REQUIRED
 *                         (min 16 chars), whatever NODE_ENV says.
 *   AMC_ADMIN_PASSWORD  — the admin password checked at login (plain). Either
 *                         this or AMC_ADMIN_PASSWORD_HASH must be set, in
 *                         every environment.
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

/** Minimum accepted length for AMC_SESSION_SECRET, in characters. */
const MIN_SESSION_SECRET_LENGTH = 16

export interface AdminSession {
  sub: 'admin'
  role: 'admin'
  issuedAt: number
  expiresAt: number
}

/**
 * True when AMC_SESSION_SECRET is present and long enough. Read lazily on every
 * call — never cached at module load, so importing this module (as the Next
 * build does) can never throw.
 */
function hasValidSessionSecret(): boolean {
  const s = process.env.AMC_SESSION_SECRET
  return typeof s === 'string' && s.length >= MIN_SESSION_SECRET_LENGTH
}

/**
 * The signing secret. Throws when unset or shorter than 16 chars, in EVERY
 * environment — there is no fallback. Callers that must not throw
 * (decodeSession) wrap this.
 */
function sessionSecret(): string {
  const s = process.env.AMC_SESSION_SECRET
  if (!s || s.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      `AMC_SESSION_SECRET is not configured (min ${MIN_SESSION_SECRET_LENGTH} chars) — auth is fail-closed.`,
    )
  }
  return s
}

/**
 * True only when the auth layer is really usable: a valid signing secret AND a
 * password source. Reflects reality in every environment — no dev shortcut.
 */
export function authConfigured(): boolean {
  const hasPassword = Boolean(process.env.AMC_ADMIN_PASSWORD || process.env.AMC_ADMIN_PASSWORD_HASH)
  return hasValidSessionSecret() && hasPassword
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
 * AMC_ADMIN_PASSWORD (plain), constant-time. No fallback password exists: if
 * neither var is configured this returns false in every environment.
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
  return false // fail-closed: no password source configured
}

/** Serialize + sign a fresh admin session into a cookie value. */
function encodeSession(session: AdminSession): string {
  const payload = b64url(Buffer.from(JSON.stringify(session)))
  return `${payload}.${sign(payload)}`
}

/** Parse + verify a cookie value; null if malformed, tampered, or expired. */
export function decodeSession(value?: string | null): AdminSession | null {
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

