import { NextResponse } from 'next/server'

import { listRepos } from '@/lib/agent-mission-control/github'

/**
 * GET /api/agent-ops/github/repos — list the authenticated user's accessible
 * GitHub repositories (READ-ONLY: no remote write ever). Server-only; delegates
 * to `listRepos` (github.ts), which reads GITHUB_TOKEN.
 *
 * Fail-closed 503 when GITHUB_TOKEN is absent — never fakes a repo list.
 * Upstream GitHub failure → 502 { error }. Mirrors copilots/route.ts.
 */
export async function GET() {
  // Fail-closed 503 when GitHub is not configured — never fabricate repos.
  if (!process.env.GITHUB_TOKEN) {
    return NextResponse.json({ error: 'GitHub not configured' }, { status: 503 })
  }

  try {
    return NextResponse.json({ repos: await listRepos() })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'GitHub error' },
      { status: 502 }
    )
  }
}
