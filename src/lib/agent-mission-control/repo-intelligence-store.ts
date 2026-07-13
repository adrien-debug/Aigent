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

export interface StoredIntelligence {
  intelligence: RepoIntelligence | null
  scannedAt: string | null
  sha: string | null
}

/** Load the cached intelligence for a project (no scan). */
export async function loadRepoIntelligence(projectId: string): Promise<StoredIntelligence> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `projects?${eq('id', projectId)}&select=repo_intelligence,repo_intelligence_at,repo_intelligence_sha`
  )
  const row = rows[0]
  if (!row) return { intelligence: null, scannedAt: null, sha: null }
  return {
    intelligence: (row.repo_intelligence as RepoIntelligence | null) ?? null,
    scannedAt: (row.repo_intelligence_at as string | null) ?? null,
    sha: (row.repo_intelligence_sha as string | null) ?? null,
  }
}

/** Persist a fresh intelligence bundle onto the project row. */
async function saveRepoIntelligence(projectId: string, intelligence: RepoIntelligence, sha: string | null): Promise<void> {
  await pgrest('PATCH', `projects?${eq('id', projectId)}`, {
    repo_intelligence: intelligence,
    repo_intelligence_at: new Date().toISOString(),
    repo_intelligence_sha: sha,
  })
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
  const project = await getProject(projectId)
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

  const intelligence = await scanRepoIntelligence(project)
  await saveRepoIntelligence(projectId, intelligence, currentSha)
  return {
    intelligence,
    scannedAt: intelligence.map.scannedAt,
    rescanned: true,
    staleness: opts.force ? 'fresh' : reason,
    hasRepo: true,
  }
}
