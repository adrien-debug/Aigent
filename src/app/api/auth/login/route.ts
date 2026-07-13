import { NextResponse } from 'next/server'

import { authConfigured, createAdminSessionCookie, verifyAdminPassword } from '@/lib/agent-mission-control/auth'

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

  const password =
    body !== null && typeof body === 'object' && typeof (body as { password?: unknown }).password === 'string'
      ? (body as { password: string }).password
      : ''

  const ok = await verifyAdminPassword(password)
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

const attempts = new Map<string, number[]>()

function clientIdentifier(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim()
    if (first) return first
  }
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim()
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
  const timestamps = (attempts.get(key) ?? []).filter((t) => t > cutoff)
  timestamps.push(Date.now())
  attempts.set(key, timestamps)
}

function clearAttempts(key: string): void {
  attempts.delete(key)
}
