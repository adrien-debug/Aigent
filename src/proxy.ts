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
 */
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

  // --- Protected pages: /admin/** requires a session, else redirect to login ---
  if (path === '/admin' || path.startsWith('/admin/')) {
    if (session) return NextResponse.next()
    const loginUrl = new URL('/login', request.url)
    // Preserve the intended destination, but only as a safe internal path.
    if (path.startsWith('/admin')) loginUrl.searchParams.set('next', path)
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
  matcher: ['/admin/:path*', '/api/agent-ops/:path*'],
}
