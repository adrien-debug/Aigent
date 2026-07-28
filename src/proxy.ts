import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { SESSION_COOKIE, decodeSession } from '@/lib/agent-mission-control/auth'

/**
 * Agent Mission Control — identity gate (Next 16 `proxy` convention, fail-closed).
 *
 * Protection is now by IDENTITY, not just origin:
 *
 *  - /admin/**  — requires a valid admin session cookie. No session → redirect
 *    to /login?next=<path>. (Pages.)
 *  - /api/agent-ops/**  — requires EITHER a valid admin session cookie OR a
 *    valid x-amc-key (server-to-server / automation). Neither → 401 JSON.
 *    Same-origin alone is NO LONGER sufficient — that's the point of this lot.
 *  - /login, /api/auth/**, /logout — always reachable (that's how you get in/out).
 *
 * The session cookie is HMAC-signed; `decodeSession` returns null on missing
 * secret, tampering, or expiry, so a missing AMC_SESSION_SECRET denies every
 * gate (fail-closed). Secrets are read server-side only; nothing here reaches
 * the browser.
 *
 * LOCAL DEV ESCAPE HATCH: when NODE_ENV !== 'production' AND the explicit opt-in
 * env `AMC_DEV_BYPASS_AUTH=1` is set, /admin/** pages skip the session gate so
 * the local dashboard opens without logging in. Double-gated on purpose — a
 * production build (NODE_ENV=production, the value Next sets for `next build`/
 * `next start` and every deploy) can NEVER be bypassed, and even in dev it's
 * off unless the flag is explicitly present. The /api/agent-ops/** surface is
 * NOT bypassed: automation still needs x-amc-key, so the escape hatch only
 * affects interactive page access, never the data API.
 */
const DEV_AUTH_BYPASS = process.env.NODE_ENV !== 'production' && process.env.AMC_DEV_BYPASS_AUTH === '1'

/**
 * Authenticated PAGE surfaces.
 *
 * MEASURED HOLE (29/07/2026): this test used to read
 * `path === '/admin' || path.startsWith('/admin/')`, and `config.matcher` only
 * listed `/admin/:path*`. A console briefly built at `/admin-v2/**` matched
 * NEITHER — not `/admin`, and starting with `/admin-`, not `/admin/` — so every
 * agent name, project, input summary and cost in the fleet answered 200 to an
 * unauthenticated request. Verified by curl before the fix (200 + real rows)
 * and after (307 to /login). That route no longer exists, but the shape of the
 * bug does: a sibling admin surface is one directory name away at any time.
 *
 * Each entry is matched as a PATH SEGMENT (exact, or followed by `/`), never as
 * a bare `startsWith`: a bare prefix would also swallow an unrelated
 * `/administration` route and grant it a gate it never asked for. A new admin
 * surface is protected by ADDING IT HERE — that is the one line to remember.
 */
const PROTECTED_PAGE_PREFIXES = ['/admin'] as const

function isProtectedPage(path: string): boolean {
  return PROTECTED_PAGE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

export function proxy(request: NextRequest) {
  const url = new URL(request.url)
  const path = url.pathname

  if (request.method === 'OPTIONS') return NextResponse.next()

  // Always-open surfaces: login page, auth API, logout, and Next internals.
  if (
    path === '/login' ||
    path.startsWith('/api/auth/') ||
    path === '/logout' ||
    path.startsWith('/_next/') ||
    path === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  const session = decodeSession(readSessionCookie(request))

  // --- Protected API surface: session OR valid automation key ---
  if (path.startsWith('/api/agent-ops/')) {
    if (session) return NextResponse.next()
    const apiKey = process.env.AMC_API_KEY
    if (apiKey && request.headers.get('x-amc-key') === apiKey) return NextResponse.next()
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  // --- Protected pages: every admin surface requires a session ---
  if (isProtectedPage(path)) {
    if (session) return NextResponse.next()
    // Local-only escape hatch (dev + explicit flag) — never in a prod build.
    if (DEV_AUTH_BYPASS) return NextResponse.next()
    const loginUrl = new URL('/login', request.url)
    // Preserve the intended destination, but only as a safe internal path.
    loginUrl.searchParams.set('next', path)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

function readSessionCookie(request: NextRequest): string | undefined {
  return request.cookies.get(SESSION_COOKIE)?.value
}

export const config = {
  // Guard the admin pages and the agent-ops API. Auth routes are allow-listed
  // inside proxy() above so they stay reachable.
  //
  // TWO LEVELS, BOTH REQUIRED. This matcher decides whether `proxy()` RUNS AT
  // ALL; `PROTECTED_PAGE_PREFIXES` decides what it does once running. Adding a
  // surface to only one of them protects NOTHING — measured, see the header.
  // Every new admin surface goes in BOTH lists, and `/admin` is listed on its
  // own because `:path*` does not match the bare segment.
  matcher: ['/admin', '/admin/:path*', '/api/agent-ops/:path*'],
}
