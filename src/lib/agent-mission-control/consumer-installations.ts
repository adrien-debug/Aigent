/**
 * Agent Mission Control — consumer installation identity (server only).
 *
 * The FOURTH trust boundary. Aigent's three existing surfaces each authenticate
 * with one shared token value per surface, which answers "is this caller
 * allowed?" but never "WHICH consumer is this?". Proving `active_in_consumer`
 * requires the second answer: an event is evidence of activation only if it
 * came from a specific, verified installation.
 *
 * TOKENS ARE HASHED, NEVER STORED OR LOGGED IN CLEAR.
 * `consumer_installations.token_hash` holds a SHA-256 hex digest. This module
 * can verify a presented token; it can never reproduce one. A token value
 * appears exactly once — as the return of `generateInstallationToken`, handed
 * to the operator provisioning the consumer — and is never persisted, echoed in
 * a response, or written to a log.
 *
 * FAIL-CLOSED. An unparseable token, an unknown hash, or a revoked row all
 * return null with no distinction: the caller learns "not authenticated" and
 * nothing more. An installation is NEVER created on the strength of an
 * incoming POST — provisioning is a deliberate operator act.
 *
 * Never import from a client component (reads the service-role key).
 */
import 'server-only'

import { createHash, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto'

import { pgrest } from './postgrest'

export type ConsumerEnvironment = 'production' | 'staging' | 'development'
export type ConsumerInstallationStatus = 'active' | 'revoked'

export interface ConsumerInstallation {
  id: string
  copilotId: string
  environment: ConsumerEnvironment
  label: string | null
  status: ConsumerInstallationStatus
  /** Last authenticated contact. Null means never observed — never a zero, never a date stand-in. */
  lastSeenAt: string | null
  /** Version the consumer reported LOADING. Null until proven; never inferred from a delivery. */
  lastVersionLoaded: string | null
  lastVersionLoadedAt: string | null
}

/** Bytes of entropy per installation token. 32 bytes = 256 bits. */
const TOKEN_BYTES = 32

/** Length of the non-secret leading fragment kept for operator disambiguation. */
const TOKEN_PREFIX_LENGTH = 8

/**
 * Minimum plausible token length. Bounds the work done on hostile input before
 * it ever reaches the database.
 */
const MIN_TOKEN_LENGTH = 16
const MAX_TOKEN_LENGTH = 512

/** SHA-256 hex digest of a token. The only form ever persisted. */
export function hashInstallationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Mint a new installation token. Returned ONCE to the provisioning operator and
 * never stored in clear — only `hash` goes to the database.
 */
export function generateInstallationToken(): { token: string; hash: string; prefix: string } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  return {
    token,
    hash: hashInstallationToken(token),
    prefix: token.slice(0, TOKEN_PREFIX_LENGTH),
  }
}

/**
 * Constant-time compare of two hex digests. Both operands are digests (fixed
 * length, non-secret-derived), but the compare stays constant-time so a
 * near-miss cannot be distinguished from a far-miss by timing.
 */
export function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return nodeTimingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  } catch {
    return false
  }
}

function rowToInstallation(row: Record<string, unknown>): ConsumerInstallation {
  return {
    id: String(row.id),
    copilotId: String(row.copilot_id),
    environment: row.environment as ConsumerEnvironment,
    label: (row.label as string | null) ?? null,
    status: row.status as ConsumerInstallationStatus,
    lastSeenAt: (row.last_seen_at as string | null) ?? null,
    lastVersionLoaded: (row.last_version_loaded as string | null) ?? null,
    lastVersionLoadedAt: (row.last_version_loaded_at as string | null) ?? null,
  }
}

/**
 * Resolve a presented token to its installation, or null.
 *
 * Null covers every failure mode without distinguishing them: malformed token,
 * unknown hash, revoked installation. The caller must translate all of them
 * into one generic 401 — a different response per case would let an attacker
 * enumerate valid installations.
 *
 * Lookup is by hash equality in the database (indexed), then re-verified in
 * constant time in-process. The re-check is belt-and-braces: it means a
 * mistaken filter that returned a wrong row still cannot authenticate.
 */
export async function authenticateInstallation(
  token: string | null,
  expectedInstallationId: string
): Promise<ConsumerInstallation | null> {
  if (!token) return null
  const trimmed = token.trim()
  if (trimmed.length < MIN_TOKEN_LENGTH || trimmed.length > MAX_TOKEN_LENGTH) return null
  if (!expectedInstallationId) return null

  const hash = hashInstallationToken(trimmed)

  const rows = (await pgrest(
    'GET',
    `consumer_installations?token_hash=eq.${encodeURIComponent(hash)}&limit=1`
  )) as Record<string, unknown>[]

  const row = Array.isArray(rows) ? rows[0] : undefined
  if (!row) return null

  // The row's own hash must match in constant time.
  if (!constantTimeHexEqual(String(row.token_hash ?? ''), hash)) return null

  const installation = rowToInstallation(row)

  // Fail-closed on revocation.
  if (installation.status !== 'active') return null

  // The token must belong to the installation the payload CLAIMS to be. A valid
  // token for installation A can never report as installation B.
  if (!constantTimeHexEqual(hashInstallationToken(installation.id), hashInstallationToken(expectedInstallationId))) {
    return null
  }

  return installation
}

/**
 * Record an authenticated contact. Called ONLY after `authenticateInstallation`
 * succeeded, so `last_seen_at` is always evidence of a verified report.
 *
 * Fail-soft: a bookkeeping failure must never reject an event that was already
 * authenticated and accepted. The event row itself is the durable record.
 */
export async function touchInstallationSeen(
  installationId: string,
  seenAt: string,
  versionLoaded?: { versionId: string; at: string }
): Promise<void> {
  const patch: Record<string, unknown> = { last_seen_at: seenAt }
  if (versionLoaded) {
    patch.last_version_loaded = versionLoaded.versionId
    patch.last_version_loaded_at = versionLoaded.at
  }
  try {
    await pgrest('PATCH', `consumer_installations?id=eq.${encodeURIComponent(installationId)}`, patch)
  } catch (err) {
    console.error(
      '[consumer-installations] failed to record last_seen_at',
      err instanceof Error ? err.message : err
    )
  }
}
