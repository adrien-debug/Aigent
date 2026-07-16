/**
 * Agent Mission Control — Repo Intelligence persistence + orchestration (server only).
 *
 * The cache layer over scanRepoIntelligence: load the last stored intelligence
 * for a project (jsonb on projects, migration 0011), decide staleness, and
 * — when missing/stale — run a fresh read-only scan and persist it. The
 * "auto-scan on project open" flow calls `ensureRepoIntelligence`.
 *
 * Live-only, fail-closed. Never writes to GitHub, never persists a secret
 * (scanRepoIntelligence is already secret-free). Never import from a client
 * component (reads the service-role key + GITHUB_TOKEN via the scan).
 */
import 'server-only'

import { getProject } from './data'
import { getRepoHeadSha } from './github'
import { pgrest } from './postgrest'
import {
  intelligenceStaleness,
  scanRepoIntelligence,
  type RepoIntelligence,
  type StalenessReason,
} from './repo-intelligence'

type RawRow = Record<string, unknown>

const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`

/**
 * Thrown when the failure originates in the gpu1/PostgREST backend (project
 * lookup or cache read/write) — NOT GitHub. Lets callers (the HTTP route) map
 * this to a 503 "backend unavailable" instead of a misleading GitHub message.
 */
export class RepoIntelligenceBackendError extends Error {
  readonly cause: unknown
  constructor(cause: unknown) {
    super('repo intelligence: backend (gpu1/PostgREST) unavailable')
    this.name = 'RepoIntelligenceBackendError'
    this.cause = cause
  }
}

/**
 * Thrown when the failure originates in the GitHub scan itself (rate limit,
 * repo inaccessible, token missing). Callers map this to a 502 GitHub message.
 */
export class RepoIntelligenceGithubError extends Error {
  readonly cause: unknown
  constructor(cause: unknown) {
    super('repo intelligence: GitHub unreachable or repo inaccessible')
    this.name = 'RepoIntelligenceGithubError'
    this.cause = cause
  }
}

export interface StoredIntelligence {
  intelligence: RepoIntelligence | null
  scannedAt: string | null
  sha: string | null
}

/** Load the cached intelligence for a project (no scan). Throws RepoIntelligenceBackendError on a PostgREST failure. */
export async function loadRepoIntelligence(projectId: string): Promise<StoredIntelligence> {
  let rows: RawRow[]
  try {
    rows = await pgrest<RawRow[]>(
      'GET',
      `projects?${eq('id', projectId)}&select=repo_intelligence,repo_intelligence_at,repo_intelligence_sha`
    )
  } catch (err) {
    throw new RepoIntelligenceBackendError(err)
  }
  const row = rows[0]
  if (!row) return { intelligence: null, scannedAt: null, sha: null }
  return {
    intelligence: (row.repo_intelligence as RepoIntelligence | null) ?? null,
    scannedAt: (row.repo_intelligence_at as string | null) ?? null,
    sha: (row.repo_intelligence_sha as string | null) ?? null,
  }
}

/** Persist a fresh intelligence bundle onto the project row. Throws RepoIntelligenceBackendError on a PostgREST failure. */
async function saveRepoIntelligence(projectId: string, intelligence: RepoIntelligence, sha: string | null): Promise<void> {
  try {
    await pgrest('PATCH', `projects?${eq('id', projectId)}`, {
      repo_intelligence: intelligence,
      repo_intelligence_at: new Date().toISOString(),
      repo_intelligence_sha: sha,
    })
  } catch (err) {
    throw new RepoIntelligenceBackendError(err)
  }
}

export interface EnsureResult {
  intelligence: RepoIntelligence | null
  scannedAt: string | null
  /** Was a fresh scan run in this call? */
  rescanned: boolean
  /** Why the cache was (or wasn't) considered stale. */
  staleness: StalenessReason
  /** True only when the project has a linked repo (else nothing to scan). */
  hasRepo: boolean
}

/**
 * The auto-scan entry point. Loads the cache, checks staleness (missing / >24h /
 * commit changed), and re-scans + persists when needed. `force` re-scans
 * unconditionally (the manual "Retry scan" button). Fail-soft on the HEAD-sha
 * lookup (a rate-limited sha check must not block using a fresh-by-age cache).
 */
export async function ensureRepoIntelligence(projectId: string, opts: { force?: boolean } = {}): Promise<EnsureResult> {
  let project: Awaited<ReturnType<typeof getProject>>
  try {
    project = await getProject(projectId)
  } catch (err) {
    // getProject() only talks to PostgREST — a failure here is a backend/DB
    // outage, never a GitHub problem. Keep that distinction for the caller.
    throw new RepoIntelligenceBackendError(err)
  }
  if (!project) throw new Error(`project not found: ${projectId}`)
  if (!project.repoFullName) {
    return { intelligence: null, scannedAt: null, rescanned: false, staleness: 'missing', hasRepo: false }
  }

  const cached = await loadRepoIntelligence(projectId)

  // Resolve the repo HEAD sha so a new commit invalidates the cache even inside
  // the TTL. Best-effort: on failure, fall through to age-based staleness only.
  let currentSha: string | null = null
  try {
    currentSha = await getRepoHeadSha(project.repoFullName)
  } catch {
    currentSha = null
  }

  const { stale, reason } = intelligenceStaleness(cached.scannedAt, cached.sha, currentSha, Date.now())

  if (!opts.force && !stale && cached.intelligence) {
    return { intelligence: cached.intelligence, scannedAt: cached.scannedAt, rescanned: false, staleness: reason, hasRepo: true }
  }

  let intelligence: RepoIntelligence
  try {
    // Pass the HEAD sha (already resolved above) as the explicit ref: the
    // default branch is resolved ONCE per rescan (inside getRepoHeadSha) instead
    // of getRepoTree re-resolving it, and the scan is pinned to the exact commit
    // whose sha we persist. When the sha lookup failed (fail-soft), fall back to
    // the previous behaviour: the scan resolves the default branch itself.
    intelligence = await scanRepoIntelligence(project, currentSha ?? undefined)
  } catch (err) {
    // scanRepoIntelligence() is the actual GitHub read (tree/file contents) —
    // a failure here is genuinely a GitHub/repo-access problem.
    throw new RepoIntelligenceGithubError(err)
  }
  await saveRepoIntelligence(projectId, intelligence, currentSha)
  return {
    intelligence,
    scannedAt: intelligence.map.scannedAt,
    rescanned: true,
    staleness: opts.force ? 'fresh' : reason,
    hasRepo: true,
  }
}
