import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Agent Mission Control — API guard (fail-closed). Next 16 `proxy` convention
 * (the former `middleware` file convention, renamed upstream).
 *
 * The /api/agent-ops/** routes are unauthenticated admin primitives: they
 * trigger real (billed) LLM runs, mutate the service_role DB, and proxy GitHub.
 * There is no login system, so this middleware gates them two ways, fail-closed:
 *
 *  1. SAME-ORIGIN ONLY (always on). A browser attaches `sec-fetch-site` and,
 *     for cross-origin requests, an `Origin` header. We allow same-origin
 *     requests (the app's own client components) and same-origin navigations,
 *     and REJECT anything whose Origin is a different host. This blocks
 *     cross-site (CSRF) and drive-by calls from other web origins.
 *
 *  2. SHARED KEY (optional, opt-in via env AMC_API_KEY). When set, a caller may
 *     ALSO authorize with header `x-amc-key: <key>` — this is the path for
 *     trusted server-to-server / CLI clients that have no browser Origin. The
 *     key is read server-side only and never sent to the browser.
 *
 * A request passes if it is same-origin OR carries the valid key. Otherwise 403.
 * GET/HEAD are still guarded (the GitHub read proxy is sensitive too).
 */
export function proxy(request: NextRequest) {
  const url = new URL(request.url)
  const method = request.method

  // Preflight: let CORS preflights through (they carry no credentials/action).
  if (method === 'OPTIONS') return NextResponse.next()

  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site') // same-origin | same-site | cross-site | none

  // Same-origin if the browser says so, or if there's no Origin header at all
  // for a same-origin navigation (sec-fetch-site: none / same-origin).
  const sameOrigin =
    fetchSite === 'same-origin' ||
    fetchSite === 'same-site' ||
    fetchSite === 'none' ||
    (origin !== null && origin === url.origin) ||
    // No Origin + no sec-fetch-site → non-browser client; fall through to key.
    (origin === null && fetchSite === null && false)

  if (sameOrigin) return NextResponse.next()

  // Cross-origin or non-browser: require the shared key when configured.
  const apiKey = process.env.AMC_API_KEY
  if (apiKey && request.headers.get('x-amc-key') === apiKey) {
    return NextResponse.next()
  }

  return NextResponse.json(
    { error: 'forbidden: cross-origin request to a protected endpoint' },
    { status: 403 }
  )
}

export const config = {
  // Guard only the agent-ops API surface; pages and static assets are untouched.
  matcher: ['/api/agent-ops/:path*'],
}
