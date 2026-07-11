import { NextResponse } from 'next/server'

import { clearAdminSessionCookie } from '@/lib/agent-mission-control/auth'

/**
 * GET /logout — clear the admin session cookie and redirect to /login.
 * A GET so a plain link in the shell can trigger it; the cookie is httpOnly
 * so the clear must happen server-side anyway.
 */
export async function GET(request: Request) {
  const res = NextResponse.redirect(new URL('/login', request.url))
  res.headers.set('Set-Cookie', clearAdminSessionCookie())
  return res
}
