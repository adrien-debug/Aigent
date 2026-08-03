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
// Hard cap on distinct tracked clients: the identifying header is
// attacker-influenced (see clientIdentifier below), so without a bound a
// flood of spoofed keys grows this map without limit (expired windows were
// only pruned when the SAME key came back).
const MAX_TRACKED_CLIENTS = 10_000
const MAX_KEY_LENGTH = 100 // longest valid textual IP is ~45 chars; don't store megabyte headers as keys

// Global ceiling, independent of any per-client key. Without this, an
// attacker who forges a fresh client identifier on every request (trivial:
// X-Forwarded-For is attacker-supplied) bypasses the per-key limiter entirely
// — each forged identity gets its own fresh MAX_ATTEMPTS budget. This second
// counter caps total password guesses across ALL clients in the same window,
// so identifier-forging narrows the attack down to "one shared budget" rather
// than defeating throttling altogether.
const GLOBAL_MAX_ATTEMPTS = 100
const GLOBAL_WINDOW_MS = 5 * 60 * 1000
let globalAttempts: number[] = []

const attempts = new Map<string, number[]>()

/**
 * How many reverse-proxy hops between the real client and this app are
 * trusted to have appended their own address to X-Forwarded-For. Aigent's
 * production deployment is fronted by a single Cloudflare Tunnel hop — see the
 * topology diagram in `deploy/app/README.md` — and no other reverse proxy sits
 * in front of the app process. (The port numbers are deliberately NOT repeated
 * here: `check:dev-port` bans banned-port literals in code, and a topology
 * recopied into a comment drifts from the deploy config it claims to describe.)
 * Kept as an explicit, named constant (not a magic "take the
 * last element") so the trust assumption is legible and can be corrected in
 * one place if the topology changes.
 */
const TRUSTED_PROXY_HOPS = 1

/**
 * Exported for direct unit testing (tests/unit/login-route-throttle.test.ts) —
 * this is pure header-parsing logic with no shared state, so it's safe and
 * useful to exercise directly rather than only indirectly through POST.
 */
export function clientIdentifier(request: Request): string {
  // Cloudflare terminates the tunnel and sets this header itself — the
  // client cannot forge it (Cloudflare overwrites any client-supplied
  // CF-Connecting-IP before it reaches the origin). This is the one header
  // that identifies the real client IP with certainty on this deployment, so
  // it's tried first.
  const cfConnectingIp = request.headers.get('cf-connecting-ip')
  if (cfConnectingIp) return cfConnectingIp.trim().slice(0, MAX_KEY_LENGTH)

  // Fallback for environments without the Cloudflare tunnel in front (local
  // dev, or a future topology change). X-Forwarded-For is a comma-separated
  // list appended-to by EACH hop between the client and us; the client
  // controls everything EXCEPT what our own trusted proxy hops appended. The
  // real client IP is therefore the element TRUSTED_PROXY_HOPS-from-the-end,
  // never the leftmost one (which the client fully controls and can spoof to
  // defeat any per-IP throttle).
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    const hops = forwardedFor.split(',').map((h) => h.trim()).filter(Boolean)
    const index = hops.length - TRUSTED_PROXY_HOPS
    const candidate = index >= 0 ? hops[index] : hops[0]
    if (candidate) return candidate.slice(0, MAX_KEY_LENGTH)
  }
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim().slice(0, MAX_KEY_LENGTH)
  return 'unknown'
}

function isGlobalRateLimited(): boolean {
  const cutoff = Date.now() - GLOBAL_WINDOW_MS
  globalAttempts = globalAttempts.filter((t) => t > cutoff)
  return globalAttempts.length >= GLOBAL_MAX_ATTEMPTS
}

function recordGlobalFailedAttempt(): void {
  const cutoff = Date.now() - GLOBAL_WINDOW_MS
  globalAttempts = globalAttempts.filter((t) => t > cutoff)
  globalAttempts.push(Date.now())
}

function isRateLimited(key: string): boolean {
  if (isGlobalRateLimited()) return true
  const timestamps = attempts.get(key)
  if (!timestamps) return false
  const cutoff = Date.now() - WINDOW_MS
  const recent = timestamps.filter((t) => t > cutoff)
  attempts.set(key, recent)
  return recent.length >= MAX_ATTEMPTS
}

function recordFailedAttempt(key: string): void {
  recordGlobalFailedAttempt()
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
