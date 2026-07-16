import { NextResponse } from 'next/server'

import {
  ensureRepoIntelligence,
  RepoIntelligenceBackendError,
  RepoIntelligenceGithubError,
} from '@/lib/agent-mission-control/repo-intelligence-store'

/**
 * GET  /api/agent-ops/projects/:id/repo/intelligence — the "auto-scan on open"
 *      endpoint. Loads the project's cached repo intelligence and re-scans
 *      READ-ONLY only if it's missing / older than 24h / the repo HEAD changed.
 * POST /api/agent-ops/projects/:id/repo/intelligence — force a fresh scan
 *      (the manual "Retry scan" button). Same read-only guarantees.
 *
 * Returns { ok, hasRepo, rescanned, staleness, scannedAt, intelligence }.
 * READ-ONLY GitHub throughout — never writes to GitHub, never returns a secret
 * (github.ts refuses secret/credential paths). Auth: src/proxy.ts. Fail-closed
 * 503 without the gpu1 backend + GITHUB_TOKEN configured up front; 502 if the
 * backend (gpu1/PostgREST — project lookup or cache read/write) fails at
 * request time (504 when that failure is the PostgREST timeout); 404 unknown
 * project; 200 with hasRepo:false when the project has no linked repo; 502 on
 * a GitHub error (generic message — no internal detail forwarded).
 */
const PROJECT_ID_RE = /^[a-z0-9-]{1,200}$/

function envReady(): boolean {
  return (
    process.env.AMC_DATA_SOURCE === 'gpu1' &&
    Boolean(process.env.AMC_SUPABASE_URL) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
    Boolean(process.env.GITHUB_TOKEN)
  )
}

/**
 * Collapse concurrent identical scans (double-click on "Retry scan", the
 * auto-scan-on-open firing twice from parallel mounts/tabs): every concurrent
 * caller with the same project+force awaits the SAME ensureRepoIntelligence
 * promise instead of each running its own GitHub tree fetch + file reads +
 * cache PATCH. Best-effort per server instance; response contract unchanged.
 */
const inflight = new Map<string, Promise<Awaited<ReturnType<typeof ensureRepoIntelligence>>>>()

function ensureDeduped(id: string, force: boolean) {
  const key = `${id}:${force ? 'force' : 'auto'}`
  const existing = inflight.get(key)
  if (existing) return existing
  const p = ensureRepoIntelligence(id, { force }).finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

async function handle(id: string, force: boolean) {
  if (!PROJECT_ID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }
  if (!envReady()) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }
  try {
    const result = await ensureDeduped(id, force)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof RepoIntelligenceBackendError) {
      // Project lookup / cache read-write against gpu1 PostgREST failed —
      // this is a backend/DB outage, never a GitHub problem. Log detail
      // server-side, return a generic backend-unavailable message. 502 like
      // every request-time upstream failure in this API (503 is reserved for
      // "not configured"); the PostgREST 30s timeout (PgrestError 504, see
      // postgrest.ts) passes through as 504.
      console.error('[agent-ops/projects/repo/intelligence] backend unavailable', err)
      const cause = err.cause
      const timedOut = cause instanceof Error && cause.name === 'PgrestError' &&
        (cause as unknown as { status?: unknown }).status === 504
      return NextResponse.json({ error: 'backend unavailable (gpu1/PostgREST)' }, { status: timedOut ? 504 : 502 })
    }
    if (err instanceof RepoIntelligenceGithubError) {
      console.error('[agent-ops/projects/repo/intelligence] GitHub scan failed', err)
      return NextResponse.json({ error: 'repo intelligence scan failed (GitHub unreachable or repo inaccessible)' }, { status: 502 })
    }
    const message = err instanceof Error ? err.message : String(err)
    if (/project not found/.test(message)) {
      return NextResponse.json({ error: 'project not found' }, { status: 404 })
    }
    console.error('[agent-ops/projects/repo/intelligence] scan failed', err)
    return NextResponse.json({ error: 'repo intelligence scan failed' }, { status: 502 })
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handle(id, false)
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handle(id, true)
}
