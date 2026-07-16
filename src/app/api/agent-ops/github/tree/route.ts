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

/** owner/name only — no `..`, no extra `/`, no query, no `@`. Bounded well
 * above GitHub's real limits (owner ≤ 39 + "/" + repo ≤ 100), same cap as the
 * `repo` field in projects/[id]/builder/run/route.ts. */
const repoSchema = z
  .string()
  .max(200, 'repo too long')
  .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, 'repo must be "owner/name"')
  // The charset regex lets `..` through (dots are legal), but the helper's
  // assertValidRepoFullName rejects it with a throw — without this refine a
  // client-input fault would surface as a 502 instead of a 400.
  .refine((v) => !v.includes('..'), 'repo must not contain ".."')

/** Git refs: branches, tags, or full SHAs — safe charset only, bounded (git
 * refs are ≤ 256 bytes in practice; a megabyte query param has no business
 * reaching the GitHub URL builder). */
const refSchema = z
  .string()
  .max(256, 'ref too long')
  .regex(/^[A-Za-z0-9._/-]+$/, 'ref contains unsafe characters')
  // Same rationale as repoSchema: assertValidRef (github.ts) throws on `..`,
  // which must stay a 400 at the edge, never a 502.
  .refine((v) => !v.includes('..'), 'ref must not contain ".."')

/**
 * GET /api/agent-ops/github/tree?repo=<fullName>&ref=<optional> — fetch a
 * repository's git tree recursively (READ-ONLY: no remote write ever).
 * Server-only; delegates to `getRepoTree` (github.ts), which reads GITHUB_TOKEN.
 *
 * `repo` missing/malformed → 400. `ref` malformed → 400. Fail-closed 503 when
 * GITHUB_TOKEN is absent. Unknown repo/ref (GitHub 404, which also covers a
 * repo the token cannot see) → 404 { error }. GitHub timeout → 504 { error }.
 * Any other upstream GitHub failure → 502 { error }. Mirrors copilots/route.ts.
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
    // Log the detail (which can embed the internal GitHub API path + up to 300
    // chars of raw upstream response body) server-side only; the client gets a
    // generic body so nothing internal leaks. Mirrors copilots/route.ts.
    console.error('[agent-ops/github/tree] getRepoTree failed:', err)
    const message = err instanceof Error ? err.message : String(err)
    // Classify by the messages `gh()` (github.ts) actually emits — the same
    // regex-on-message pattern as push-agent/route.ts and readHostRegistry.
    // "GitHub 404 on GET repos/…" = unknown repo or ref (both the tree fetch
    // and the default-branch resolution are GETs): the client named a resource
    // that does not exist for this token → 404, not an upstream failure.
    if (/^GitHub 404 on GET repos\//.test(message)) {
      return NextResponse.json({ error: 'repo or ref not found' }, { status: 404 })
    }
    // "GitHub request timed out after …" = the 15s AbortSignal ceiling → 504,
    // consistent with the PgrestError(504) timeout remap in postgrest.ts.
    if (/^GitHub request timed out after /.test(message)) {
      return NextResponse.json({ error: 'GitHub timeout' }, { status: 504 })
    }
    return NextResponse.json({ error: 'GitHub error' }, { status: 502 })
  }
}
