import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { SESSION_COOKIE, decodeSession } from '@/lib/agent-mission-control/auth'

/**
 * Agent Mission Control — API identity gate (fail-closed).
 *
 * After frontend reset there is no admin UI surface. This proxy protects only
 * `/api/agent-ops/**` via session cookie OR `x-amc-key`. Pages and auth routes
 * (`/login`, `/api/auth/**`, `/logout`) stay reachable for future reconstruction.
 */
export function proxy(request: NextRequest) {
  const url = new URL(request.url)
  const path = url.pathname

  if (request.method === 'OPTIONS') return NextResponse.next()

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

  if (path.startsWith('/api/agent-ops/')) {
    if (session) return NextResponse.next()
    const apiKey = process.env.AMC_API_KEY
    if (apiKey && request.headers.get('x-amc-key') === apiKey) return NextResponse.next()
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  return NextResponse.next()
}

function readSessionCookie(request: NextRequest): string | undefined {
  return request.cookies.get(SESSION_COOKIE)?.value
}

export const config = {
  matcher: ['/api/agent-ops/:path*'],
}
