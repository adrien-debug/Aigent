import { NextResponse } from 'next/server'

import { listRepos } from '@/lib/agent-mission-control/github'

/**
 * GET /api/agent-ops/github/repos — list the authenticated user's accessible
 * GitHub repositories (READ-ONLY: no remote write ever). Server-only; delegates
 * to `listRepos` (github.ts), which reads GITHUB_TOKEN.
 *
 * No query params to validate here — `listRepos` takes no arguments, so this
 * route carries none of the `repo`/`path`/`ref` injection surface that
 * file/route.ts and tree/route.ts must guard against.
 *
 * Fail-closed 503 when GITHUB_TOKEN is absent — never fakes a repo list.
 * Upstream GitHub failure → 502 { error } ; upstream timeout → 504 { error }.
 * Mirrors copilots/route.ts.
 */
export async function GET() {
  // Fail-closed 503 when GitHub is not configured — never fabricate repos.
  if (!process.env.GITHUB_TOKEN) {
    return NextResponse.json({ error: 'GitHub not configured' }, { status: 503 })
  }

  try {
    return NextResponse.json({ repos: await listRepos() })
  } catch (err) {
    // Log the detail (which can embed the internal GitHub API path + up to 300
    // chars of raw upstream response body) server-side only; return a generic
    // 502 so nothing internal leaks to the client. Mirrors ../tree/route.ts and
    // ../file/route.ts.
    console.error('[agent-ops/github/repos] listRepos failed:', err)
    // gh() (github.ts) remaps AbortSignal timeouts into an Error whose message
    // reads "GitHub request timed out after <n>ms on <method> <path>" — that is
    // a gateway timeout, not a generic upstream failure: surface it as 504.
    if (err instanceof Error && err.message.includes('timed out after')) {
      return NextResponse.json({ error: 'GitHub timeout' }, { status: 504 })
    }
    return NextResponse.json({ error: 'GitHub error' }, { status: 502 })
  }
}
