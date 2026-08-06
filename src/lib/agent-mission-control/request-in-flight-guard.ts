import 'server-only'

// In-process set of active keys. One Set per Node.js process; multiple
// concurrent requests sharing the same process cannot both hold the same key.
// Released in `finally` so a thrown fn() never leaves the key permanently
// blocked (same pattern as copilots/[copilotId]/run/route.ts).
const inFlight = new Set<string>()

/**
 * Ensures at most ONE concurrent execution per `key` within this process.
 *
 * - Returns `{ conflict: true }` immediately if `key` is already in flight.
 * - Otherwise runs `fn()`, releases the lock in `finally`, and returns the
 *   resolved value.
 *
 * Callers are responsible for mapping `{ conflict: true }` to an HTTP 409
 * response or equivalent. The guard is intentionally in-process (not
 * distributed) — it stops the real double-submit cases (double-click, two
 * tabs, client retry) from firing two billed model calls, which is the
 * problem it is designed to solve. A distributed fence would be needed for
 * multi-replica deployments; this one is correct for a single-process dev
 * or single-instance production server.
 */
export async function withInFlightGuard<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T | { conflict: true }> {
  if (inFlight.has(key)) {
    return { conflict: true }
  }
  inFlight.add(key)
  try {
    return await fn()
  } finally {
    inFlight.delete(key)
  }
}

/**
 * Type-narrowing helper: returns true when the value returned by
 * `withInFlightGuard` is a conflict sentinel rather than the real result.
 */
export function isConflict(value: unknown): value is { conflict: true } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).conflict === true
  )
}
