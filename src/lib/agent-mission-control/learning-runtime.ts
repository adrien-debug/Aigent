/**
 * learning-runtime.ts — server-only client for the future H-Supervised
 * learning engine.
 *
 * SCOPE OF THIS MISSION: health/capabilities ONLY. No POST/PUT/PATCH/DELETE
 * is issued here, and none should be added without a dedicated mission — this
 * module is a read-only probe, not a client for the eventual write surface.
 *
 * Doctrine, same as `bearer-token-auth.ts` and the other trust-boundary
 * modules: the runtime lives behind ITS OWN url/token pair
 * (`AIGENT_LEARNING_RUNTIME_URL` / `AIGENT_LEARNING_RUNTIME_TOKEN`), never
 * borrowed from `AMC_API_KEY` or any of the other three tokens documented in
 * AGENTS.md. This module has NO dependency on H-Supervised's own legal
 * Supabase project — Aigent only ever talks to its HTTP health surface.
 *
 * `server-only` is already a dependency of this repo (see postgrest.ts,
 * dashboard-overview.ts), so the import below is the real guard, not a
 * comment: a client component that tries to import this module fails the
 * build instead of silently bundling a token-reading function into the
 * browser.
 */
import 'server-only'

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LearningRuntimeStatus = 'live' | 'partial' | 'unavailable' | 'not_configured'

export type LearningRuntimeHealth = {
  status: LearningRuntimeStatus
  /** ISO 8601 instant this health snapshot was produced — always set, even
   *  for `not_configured` (no network call, but the check still happened). */
  checkedAt: string
  /** The runtime's base URL with NO credential attached — this is a plain
   *  `AIGENT_LEARNING_RUNTIME_URL` read, never a token-bearing request URL.
   *  `null` only when no URL is configured. */
  endpoint: string | null
  /**
   * Capability names reported by the runtime. `null` means "not measured" —
   * either because no call was made (`not_configured`), the call failed
   * (`unavailable`), or the payload omitted the field (`partial`). An empty
   * array `[]` is reserved for a runtime that was actually reached and
   * genuinely reported zero capabilities — that is a measured fact, not the
   * default filler for "we don't know". Never conflate the two.
   */
  capabilities: string[] | null
  /** Human-readable reason for a non-`live` status. `null` only when `live`. */
  detail: string | null
  /** Wall-clock round trip in milliseconds, when one was actually measured.
   *  `null` for `not_configured` (no call attempted) and for any failure mode
   *  where a duration could not be captured. */
  latencyMs: number | null
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Hard, bounded timeout for the health probe — a stuck learning runtime must
 *  never stall a caller (e.g. an overview aggregation) indefinitely. Named
 *  and exported so a test can assert against it instead of a magic number. */
export const LEARNING_RUNTIME_TIMEOUT_MS = 5_000

/** Relative path for the health/capabilities probe on the learning runtime.
 *  Kept as a constant so a future capabilities-only extension doesn't have to
 *  hunt for a literal string. */
const HEALTH_PATH = '/health'

type LearningRuntimeConfig = {
  baseUrl: string
  token: string
}

function readConfig(): LearningRuntimeConfig | null {
  const baseUrl = process.env.AIGENT_LEARNING_RUNTIME_URL
  const token = process.env.AIGENT_LEARNING_RUNTIME_TOKEN
  if (!baseUrl || !token) return null
  return { baseUrl, token }
}

/** Strips any trailing slash so `${baseUrl}${HEALTH_PATH}` never doubles up
 *  on `//`. Pure string hygiene, not a validation of the URL's shape. */
function joinPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

/**
 * The health payload we ACCEPT as complete. `capabilities` is required and
 * must be an array of strings — its absence is exactly the signal that
 * downgrades a reachable runtime from `live` to `partial` (see
 * `getLearningRuntimeHealth`). Anything additional the runtime sends is
 * ignored (no `.strict()`): forward-compatibility with a richer payload is
 * free, we just never assumed unknown fields imply completeness.
 */
const healthPayloadSchema = z.object({
  capabilities: z.array(z.string()),
})

type HealthPayload = z.infer<typeof healthPayloadSchema>

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reads health/capabilities from the H-Supervised learning runtime.
 *
 * DERIVATION RULES (all four outcomes are terminal — no retry here, a caller
 * that wants a retry loop builds it, this function reports one attempt):
 *  · no `AIGENT_LEARNING_RUNTIME_URL`/`TOKEN` configured → `not_configured`,
 *    `capabilities: null`, and NO NETWORK CALL is attempted at all — this is
 *    the fail-closed contract the rest of the codebase already uses for
 *    unconfigured surfaces (see `requireBackend()` in postgrest.ts).
 *  · configured but the fetch throws (network refusal), times out, or
 *    returns a non-2xx status → `unavailable`, with `detail` naming WHICH of
 *    the three it was (never the generic default) and `latencyMs` set
 *    whenever a duration could actually be measured (a timeout/network
 *    refusal usually can't; an HTTP error response can).
 *  · 2xx but the body fails `healthPayloadSchema` (missing/malformed
 *    `capabilities`) → `partial`, `capabilities: null`, `detail` explains the
 *    payload was incomplete. A malformed payload is a fact about the
 *    runtime's current state, not a crash in Aigent.
 *  · 2xx and the body validates → `live`, `capabilities` holds the real,
 *    validated array (including a genuine `[]`).
 *
 * The token NEVER appears in `endpoint`, in `detail`, or in any thrown/caught
 * error message surfaced here — only used as the `Authorization` header value
 * sent to the runtime.
 */
export async function getLearningRuntimeHealth(): Promise<LearningRuntimeHealth> {
  const checkedAt = new Date().toISOString()
  const config = readConfig()

  if (config === null) {
    return {
      status: 'not_configured',
      checkedAt,
      endpoint: null,
      capabilities: null,
      detail:
        'AIGENT_LEARNING_RUNTIME_URL and/or AIGENT_LEARNING_RUNTIME_TOKEN are not set — the learning runtime ' +
        'has never been contacted this round.',
      latencyMs: null,
    }
  }

  const endpoint = config.baseUrl
  const url = joinPath(config.baseUrl, HEALTH_PATH)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), LEARNING_RUNTIME_TIMEOUT_MS)
  const startedAt = Date.now()

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: controller.signal,
    })
    const latencyMs = Date.now() - startedAt

    if (!response.ok) {
      return {
        status: 'unavailable',
        checkedAt,
        endpoint,
        capabilities: null,
        detail: `Learning runtime responded with HTTP ${response.status}.`,
        latencyMs,
      }
    }

    let raw: unknown
    try {
      raw = await response.json()
    } catch {
      return {
        status: 'partial',
        checkedAt,
        endpoint,
        capabilities: null,
        detail: 'Learning runtime returned a 2xx response with a non-JSON body.',
        latencyMs,
      }
    }

    const parsed = healthPayloadSchema.safeParse(raw)
    if (!parsed.success) {
      return {
        status: 'partial',
        checkedAt,
        endpoint,
        capabilities: null,
        detail: 'Learning runtime payload did not match the expected health schema (capabilities missing or malformed).',
        latencyMs,
      }
    }

    const payload: HealthPayload = parsed.data
    return {
      status: 'live',
      checkedAt,
      endpoint,
      capabilities: payload.capabilities,
      detail: null,
      latencyMs,
    }
  } catch (err) {
    const latencyMs = Date.now() - startedAt
    const timedOut = err instanceof Error && err.name === 'AbortError'
    return {
      status: 'unavailable',
      checkedAt,
      endpoint,
      capabilities: null,
      detail: timedOut
        ? `Learning runtime did not respond within ${LEARNING_RUNTIME_TIMEOUT_MS}ms (timeout).`
        : 'Learning runtime request failed (network error).',
      latencyMs,
    }
  } finally {
    clearTimeout(timeout)
  }
}
