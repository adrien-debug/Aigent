import { NextResponse } from 'next/server'
import { z } from 'zod'

import { authConfigured, createAdminSessionCookie, verifyAdminPassword } from '@/lib/agent-mission-control/auth'

/**
 * Body contract. `.max(1024)` bounds the only attacker-controlled string this
 * unauthenticated route hashes — without it a multi-megabyte "password" is
 * buffered and sha256'd on every guess. No real admin password approaches 1 KiB.
 */
const loginBodySchema = z.object({
  password: z.string().min(1).max(1024),
})

/**
 * POST /api/auth/login — exchange the admin password for a signed session
 * cookie. Fail-closed: if the auth layer isn't configured (no session secret /
 * no password source) login is impossible and returns 503. Wrong password →
 * 401. The password is read from the body, checked constant-time, and never
 * echoed back. On success sets the httpOnly session cookie.
 *
 * This route is NOT behind the session gate (the proxy excludes /api/auth/**)
 * — it's how a session is obtained in the first place. Since there's a single
 * admin identity (no username), there's no user-enumeration surface; the one
 * remaining risk for an unauthenticated, high-value endpoint like this is
 * unthrottled password guessing, so failed attempts are throttled per client
 * below (in-process, best-effort — see note on the limiter).
 */
export async function POST(request: Request) {
  if (!authConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'Authentication is not configured on the server.' },
      { status: 503 }
    )
  }

  const clientKey = clientIdentifier(request)
  if (isRateLimited(clientKey)) {
    return NextResponse.json(
      { ok: false, error: 'Too many attempts. Try again later.' },
      { status: 429 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  }

  const parsed = loginBodySchema.safeParse(body)
  if (!parsed.success) {
    // Malformed shape (missing/empty/non-string/oversized password) is a 400
    // like malformed JSON above — only a well-formed wrong password is a 401.
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  }

  const ok = await verifyAdminPassword(parsed.data.password)
  if (!ok) {
    recordFailedAttempt(clientKey)
    return NextResponse.json({ ok: false, error: 'Invalid password.' }, { status: 401 })
  }

  clearAttempts(clientKey)
  const res = NextResponse.json({ ok: true })
  res.headers.set('Set-Cookie', createAdminSessionCookie())
  return res
}

// --- Brute-force throttle (in-process, best-effort) -----------------------
//
// Single-admin auth has no username to enumerate, so the remaining login
// risk is unthrottled password guessing. This is a minimal sliding-window
// limiter scoped to this route only — no shared state, no new dependency.
// It resets on redeploy/restart and isn't shared across instances; that's an
// accepted trade-off for a low-traffic admin login rather than pulling in an
// external store for a single-file fix. Keyed by client IP (falls back to a
// shared bucket if the request carries none, e.g. some local/proxy setups).

const MAX_ATTEMPTS = 10
const WINDOW_MS = 5 * 60 * 1000 // 5 minutes
// Hard cap on distinct tracked clients: x-forwarded-for is attacker-supplied,
// so without a bound a flood of spoofed keys grows this map without limit
// (expired windows were only pruned when the SAME key came back).
const MAX_TRACKED_CLIENTS = 10_000
const MAX_KEY_LENGTH = 100 // longest valid textual IP is ~45 chars; don't store megabyte headers as keys

const attempts = new Map<string, number[]>()

function clientIdentifier(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim()
    if (first) return first.slice(0, MAX_KEY_LENGTH)
  }
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim().slice(0, MAX_KEY_LENGTH)
  return 'unknown'
}

function isRateLimited(key: string): boolean {
  const timestamps = attempts.get(key)
  if (!timestamps) return false
  const cutoff = Date.now() - WINDOW_MS
  const recent = timestamps.filter((t) => t > cutoff)
  attempts.set(key, recent)
  return recent.length >= MAX_ATTEMPTS
}

function recordFailedAttempt(key: string): void {
  const cutoff = Date.now() - WINDOW_MS
  if (!attempts.has(key) && attempts.size >= MAX_TRACKED_CLIENTS) {
    // Evict fully-expired windows first; if every entry is still live, drop
    // the oldest-inserted key (Map preserves insertion order) so the map
    // stays bounded even under a spoofed-key flood.
    for (const [k, ts] of attempts) {
      if (!ts.some((t) => t > cutoff)) attempts.delete(k)
    }
    if (attempts.size >= MAX_TRACKED_CLIENTS) {
      const oldest = attempts.keys().next().value
      if (oldest !== undefined) attempts.delete(oldest)
    }
  }
  const timestamps = (attempts.get(key) ?? []).filter((t) => t > cutoff)
  timestamps.push(Date.now())
  attempts.set(key, timestamps)
}

function clearAttempts(key: string): void {
  attempts.delete(key)
}
