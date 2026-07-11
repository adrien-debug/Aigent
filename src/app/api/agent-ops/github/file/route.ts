import { NextResponse } from 'next/server'

import { getRepoFile } from '@/lib/agent-mission-control/github'

/**
 * GET /api/agent-ops/github/file?repo=<fullName>&path=<path>&ref=<optional> —
 * read a single file's UTF-8 contents from a repository (READ-ONLY: no remote
 * write ever). Server-only; delegates to `getRepoFile` (github.ts), which reads
 * GITHUB_TOKEN.
 *
 * `repo`/`path` missing → 400. Fail-closed 503 when GITHUB_TOKEN is absent.
 * Upstream GitHub failure → 502 { error }. Mirrors copilots/route.ts.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const repo = searchParams.get('repo')
  const path = searchParams.get('path')
  const ref = searchParams.get('ref')

  if (!repo) {
    return NextResponse.json({ error: 'repo is required' }, { status: 400 })
  }
  if (!path) {
    return NextResponse.json({ error: 'path is required' }, { status: 400 })
  }

  // Fail-closed 503 when GitHub is not configured — never fabricate file content.
  if (!process.env.GITHUB_TOKEN) {
    return NextResponse.json({ error: 'GitHub not configured' }, { status: 503 })
  }

  try {
    return NextResponse.json(await getRepoFile(repo, path, ref ?? undefined))
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'GitHub error' },
      { status: 502 }
    )
  }
}
