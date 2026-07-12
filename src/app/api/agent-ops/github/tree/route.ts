import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getRepoTree } from '@/lib/agent-mission-control/github'

// `repo`/`ref` are attacker-controlled query params that flow straight into a
// GitHub API URL fetched with the server's GITHUB_TOKEN (see github.ts). This
// route is otherwise a universal read oracle over every repo the token can
// see (not just Aigent projects), so the query string is validated at the
// edge before it ever reaches `getRepoTree`. Kept in sync with the identical
// schemas in ../file/route.ts (repo/ref) — no shared module because each
// route in this trio is single-owner.

/** owner/name only — no `..`, no extra `/`, no query, no `@`. */
const repoSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, 'repo must be "owner/name"')

/** Git refs: branches, tags, or full SHAs — safe charset only. */
const refSchema = z
  .string()
  .regex(/^[A-Za-z0-9._/-]+$/, 'ref contains unsafe characters')

/**
 * GET /api/agent-ops/github/tree?repo=<fullName>&ref=<optional> — fetch a
 * repository's git tree recursively (READ-ONLY: no remote write ever).
 * Server-only; delegates to `getRepoTree` (github.ts), which reads GITHUB_TOKEN.
 *
 * `repo` missing/malformed → 400. `ref` malformed → 400. Fail-closed 503 when
 * GITHUB_TOKEN is absent. Upstream GitHub failure → 502 { error }. Mirrors
 * copilots/route.ts.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const repo = searchParams.get('repo')
  const ref = searchParams.get('ref')

  if (!repo) {
    return NextResponse.json({ error: 'repo is required' }, { status: 400 })
  }
  const repoResult = repoSchema.safeParse(repo)
  if (!repoResult.success) {
    return NextResponse.json(
      { error: 'repo must match "owner/name" (letters, digits, dot, underscore, hyphen only)' },
      { status: 400 }
    )
  }
  if (ref !== null) {
    const refResult = refSchema.safeParse(ref)
    if (!refResult.success) {
      return NextResponse.json({ error: 'ref contains unsafe characters' }, { status: 400 })
    }
  }

  // Fail-closed 503 when GitHub is not configured — never fabricate a tree.
  if (!process.env.GITHUB_TOKEN) {
    return NextResponse.json({ error: 'GitHub not configured' }, { status: 503 })
  }

  try {
    return NextResponse.json({
      entries: await getRepoTree(repoResult.data, ref ?? undefined),
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'GitHub error' },
      { status: 502 }
    )
  }
}
