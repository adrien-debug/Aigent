import { NextResponse } from 'next/server'

import { getRepoTree } from '@/lib/agent-mission-control/github'

/**
 * GET /api/agent-ops/github/tree?repo=<fullName>&ref=<optional> — fetch a
 * repository's git tree recursively (READ-ONLY: no remote write ever).
 * Server-only; delegates to `getRepoTree` (github.ts), which reads GITHUB_TOKEN.
 *
 * `repo` missing → 400. Fail-closed 503 when GITHUB_TOKEN is absent.
 * Upstream GitHub failure → 502 { error }. Mirrors copilots/route.ts.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const repo = searchParams.get('repo')
  const ref = searchParams.get('ref')

  if (!repo) {
    return NextResponse.json({ error: 'repo is required' }, { status: 400 })
  }

  // Fail-closed 503 when GitHub is not configured — never fabricate a tree.
  if (!process.env.GITHUB_TOKEN) {
    return NextResponse.json({ error: 'GitHub not configured' }, { status: 503 })
  }

  try {
    return NextResponse.json({ entries: await getRepoTree(repo, ref ?? undefined) })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'GitHub error' },
      { status: 502 }
    )
  }
}
