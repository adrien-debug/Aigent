import { NextResponse } from 'next/server'

import { clearAdminSessionCookie } from '@/lib/agent-mission-control/auth'

/**
 * GET /logout — clear the admin session cookie and redirect to the cockpit root.
 * A GET so a plain link in the shell can trigger it; the cookie is httpOnly
 * so the clear must happen server-side anyway.
 *
 * Redirects to `/`, NOT `/login`: the login page was deleted with the frontend
 * reset and `check:no-legacy-front` forbids its return. Rebuilding it is a
 * separate decision — until then, sending a logged-out operator to a 404 would
 * be worse than sending them to the root the identity guard already governs.
 */
export async function GET(request: Request) {
  const res = NextResponse.redirect(new URL('/', request.url))
  res.headers.set('Set-Cookie', clearAdminSessionCookie())
  return res
}
