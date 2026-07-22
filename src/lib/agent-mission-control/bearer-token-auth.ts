import 'server-only'

/**
 * Shared bearer-token extraction + constant-time compare for the two
 * server-to-server auth surfaces that each authenticate with their OWN
 * dedicated token: the runtime registry API (AIGENT_RUNTIME_API_TOKEN,
 * runtime-api-types.ts) and the telemetry ingestion endpoint
 * (AIGENT_RUNTIME_TELEMETRY_TOKEN, /api/runtime-telemetry). They used to carry
 * byte-identical copies of this logic; a single source removes the drift risk.
 *
 * Neither surface shares a token with the other or with the AMC admin key — the
 * token VALUE is supplied by each caller; only the extraction/compare mechanics
 * live here.
 */

/** Longest a well-formed token is ever expected to be; bounds the compare. */
export const MAX_TOKEN_LENGTH = 512

/**
 * Read a bearer token from `Authorization: Bearer <t>`, or from a
 * surface-specific fallback header (e.g. `x-aigent-runtime-token`). Trimmed and
 * length-capped. Returns null when neither is present.
 */
export function extractBearerToken(request: Request, fallbackHeader?: string): string | null {
  const bearer = request.headers.get('authorization')
  if (bearer) {
    const match = /^Bearer\s+(.+)$/i.exec(bearer.trim())
    if (match?.[1]) return match[1].trim().slice(0, MAX_TOKEN_LENGTH)
  }
  if (fallbackHeader) {
    const header = request.headers.get(fallbackHeader)
    if (header) return header.trim().slice(0, MAX_TOKEN_LENGTH)
  }
  return null
}

/** Constant-time string compare — avoids leaking token length/prefix via timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
