import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getRepoFile } from '@/lib/agent-mission-control/github'

// `repo`/`path`/`ref` are attacker-controlled query params that flow straight
// into a GitHub API URL fetched with the server's GITHUB_TOKEN (see
// github.ts). Unlike this route, the agent-facing tool in
// src/langgraph/tool-registry.mjs scopes reads to a single copilot's repo AND
// denies secret/credential paths (SECRET_PATH_PATTERNS/isSecretPath) — this
// HTTP route had neither, making it a universal read oracle over every repo
// (and every file, including `.env`) the token can see. Validated here before
// the request ever reaches `getRepoFile`. Kept in sync with the identical
// repo/ref schemas in ../tree/route.ts — no shared module because each route
// in this trio is single-owner.

/** owner/name only — no `..`, no extra `/`, no query, no `@`. */
const repoSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, 'repo must be "owner/name"')

/** Git refs: branches, tags, or full SHAs — safe charset only. */
const refSchema = z
  .string()
  .regex(/^[A-Za-z0-9._/-]+$/, 'ref contains unsafe characters')

/**
 * Secret/credential path denylist — a local re-implementation of
 * SECRET_PATH_PATTERNS/isSecretPath from src/langgraph/tool-registry.mjs
 * (not imported: that module is owned by another surface and this route must
 * stay self-contained). Keep the two lists in sync by hand if either changes.
 */
const SECRET_PATH_PATTERNS = [
  /(^|\/)\.env(\.|$)/i,
  /\.pem$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
  // "secret"/"secrets" as a delimited token (start, /, ., _ or -) — matches
  // secret.json, my_secret.txt, db-secret.yaml, secrets.yml; NOT secretary.js.
  /(^|[/._-])secrets?([/._-]|$)/i,
  /\.key$/i,
  /(^|\/)credentials(\.|$)/i,
  /\.pfx$/i,
  /\.p12$/i,
]

/** @returns true if `p` looks like a secret/credential file, or attempts path traversal. */
function isRefusedPath(p: string): boolean {
  if (p.includes('..')) return true
  return SECRET_PATH_PATTERNS.some((re) => re.test(p))
}

/**
 * GET /api/agent-ops/github/file?repo=<fullName>&path=<path>&ref=<optional> —
 * read a single file's UTF-8 contents from a repository (READ-ONLY: no remote
 * write ever). Server-only; delegates to `getRepoFile` (github.ts), which reads
 * GITHUB_TOKEN.
 *
 * `repo`/`path` missing → 400. `repo`/`ref` malformed → 400. `path` targeting
 * a secret/credential file or attempting traversal → 403. Fail-closed 503
 * when GITHUB_TOKEN is absent. Upstream GitHub failure → 502 { error }.
 * Mirrors copilots/route.ts.
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
  if (isRefusedPath(path)) {
    return NextResponse.json({ error: 'refused: secret/credential path' }, { status: 403 })
  }

  // Fail-closed 503 when GitHub is not configured — never fabricate file content.
  if (!process.env.GITHUB_TOKEN) {
    return NextResponse.json({ error: 'GitHub not configured' }, { status: 503 })
  }

  try {
    return NextResponse.json(await getRepoFile(repoResult.data, path, ref ?? undefined))
  } catch (err) {
    // Log the full error server-side only — getRepoFile's message can carry the
    // GitHub API path and up to 300 chars of the raw upstream response body
    // (github.ts), which must never reach the client. Public contract stays
    // generic. Mirrors the neighboring agent-ops routes.
    console.error('[agent-ops/github/file] read failed', err)
    return NextResponse.json({ error: 'failed to read file' }, { status: 502 })
  }
}
