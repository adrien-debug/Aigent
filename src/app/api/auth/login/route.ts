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
 * — it's how a session is obtained in the first place.
 */
export async function POST(request: Request) {
  if (!authConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'Authentication is not configured on the server.' },
      { status: 503 }
    )
  }

  let body: { password?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  }

  const ok = await verifyAdminPassword(typeof body.password === 'string' ? body.password : '')
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'Invalid password.' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.headers.set('Set-Cookie', createAdminSessionCookie())
  return res
}
