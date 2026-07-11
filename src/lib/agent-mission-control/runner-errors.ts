/**
 * Agent Mission Control — runner error types (server only).
 *
 * A typed sentinel the runners throw for "resource missing / mismatched"
 * conditions (unknown copilot, suite that doesn't belong to it, no serving
 * version). API routes map `instanceof NotFoundError` → 404 deterministically,
 * instead of pattern-matching error prose. Everything else stays a 502.
 */
import 'server-only'

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}
