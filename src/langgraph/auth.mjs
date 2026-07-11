/**
 * Auth handler for the public LangGraph Agent Server (agent.hearst.app).
 *
 * The langgraphjs Agent Server has NO native auth. Deployed publicly, every
 * endpoint (create thread, run a graph, read/write state via the graph's
 * service-role PostgREST tools) would be reachable by anyone on the internet.
 * This handler closes that hole with a shared-secret gate: only a caller that
 * presents the correct secret — i.e. the Aigent Next app — may invoke anything.
 *
 * Contract (verified against @langchain/langgraph-api registerAuth/authenticate):
 *   - langgraph.json points `auth.path` at "<file>:<export>". The runtime does
 *     `import(file)[export]` and REQUIRES the value to be an `Auth` instance
 *     (it checks for the internal "~handlerCache"), else it throws. So this file
 *     must export an `Auth` instance — here `auth` (matched in langgraph.json).
 *   - `authenticate(cb)` registers a callback `(request: Request) => identity`.
 *     `request` is the raw Web `Request` (server passes `c.req.raw`), so we read
 *     headers with `request.headers.get(...)`.
 *   - Return a string OR `{ identity, permissions?, ... }` to ACCEPT.
 *     Throw `HTTPException(status, { message })` to REJECT (the server maps it to
 *     that HTTP status via convertError).
 *
 * The app sends the secret as the `x-agent-key` header (see
 * src/lib/agent-mission-control/langgraph-server.ts). We also accept
 * `Authorization: Bearer <secret>` as an alternative.
 *
 * FAIL-CLOSED: if `LANGGRAPH_SERVER_SECRET` is not configured in the server's
 * environment, we reject EVERY request (503). A deployment that forgot the
 * secret must NOT silently accept traffic — an unauthenticated public server is
 * exactly the failure mode this handler exists to prevent.
 */
import { createHash, timingSafeEqual } from 'node:crypto'

import { Auth, HTTPException } from '@langchain/langgraph-sdk/auth'

/**
 * Constant-time secret comparison.
 *
 * `timingSafeEqual` throws if the two buffers differ in length — and the length
 * of the incoming header would itself be a (tiny) side channel. We normalize by
 * hashing both sides to fixed-length SHA-256 digests first, then compare those
 * in constant time. Equal digests ⇒ equal secrets (collision-resistant), and
 * the comparison time no longer depends on the attacker-supplied length/content.
 */
function secretsMatch(provided, expected) {
  const a = createHash('sha256').update(String(provided), 'utf8').digest()
  const b = createHash('sha256').update(String(expected), 'utf8').digest()
  return timingSafeEqual(a, b)
}

/** Pull the presented secret from `x-agent-key` or `Authorization: Bearer …`. */
function extractPresentedSecret(request) {
  const headerKey = request.headers.get('x-agent-key')
  if (headerKey) return headerKey

  const authorization = request.headers.get('authorization')
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
    if (match) return match[1]
  }
  return null
}

export const auth = new Auth().authenticate(async (request) => {
  // Liveness endpoint is public — a health check must not need the secret, and
  // /ok reveals nothing (it only says the server is up). Everything else is gated.
  try {
    const path = new URL(request.url).pathname
    if (path === '/ok') return { identity: 'healthcheck', permissions: [] }
  } catch {
    // Unparseable URL → fall through to the secret gate (fail-closed).
  }

  // Trimmed on both sides: a trailing newline in the server's env value (common
  // when the secret is provisioned via `.env` files or `$(cat file)`) would
  // otherwise never match the header value, which cannot itself carry a
  // newline — every request would silently 401. Trimming removes that
  // mismatch without weakening the comparison (secretsMatch stays constant-time).
  const expected = process.env.LANGGRAPH_SERVER_SECRET?.trim()

  // FAIL-CLOSED: no configured secret ⇒ reject everything. Never open by default.
  if (!expected || expected.length === 0) {
    throw new HTTPException(503, {
      message: 'Agent server auth not configured (LANGGRAPH_SERVER_SECRET missing).',
    })
  }

  const presented = extractPresentedSecret(request)?.trim()
  if (!presented) {
    throw new HTTPException(401, { message: 'Missing agent key.' })
  }

  if (!secretsMatch(presented, expected)) {
    throw new HTTPException(401, { message: 'Invalid agent key.' })
  }

  // Authenticated: the Aigent app. Minimal identity — no per-user scoping here,
  // the secret alone gates the whole server.
  return { identity: 'aigent-app', permissions: [] }
})
