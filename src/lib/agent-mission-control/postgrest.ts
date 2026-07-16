/**
 * Agent Mission Control — shared PostgREST client (server only).
 *
 * Single fetch-based PostgREST client (service_role, zero deps) shared by
 * the read layer (data.ts), the authoring writes (authoring-writes.ts), the
 * execution runner (runner.ts), and any agent-ops API route that needs to
 * talk to the gpu1 perimeter directly. Behavior is identical to (and
 * consolidates) the previously-duplicated requireBackend()/rest()/
 * camelRow() implementations in those files.
 *
 * LIVE ONLY. The single source is the gpu1 PostgREST perimeter (base
 * `aigent`). There is NO mock fallback: if the backend is not configured or
 * unreachable, every call throws — the app never fabricates data.
 *
 * Required env: AMC_DATA_SOURCE=gpu1, AMC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *
 * Never import this module from a client component: it reads the service
 * role key.
 */
import 'server-only'

/** Resolve the live gpu1 PostgREST backend, or throw (fail-closed, no mock). */
export function requireBackend(): { base: string; key: string } {
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    throw new Error(
      'Agent Mission Control is live-only: set AMC_DATA_SOURCE=gpu1, AMC_SUPABASE_URL and ' +
        'SUPABASE_SERVICE_ROLE_KEY. No mock dataset is bundled.'
    )
  }
  return { base, key }
}

/**
 * Thrown by pgrest() on a non-OK response. `.message` is a generic, safe
 * summary (`PostgREST <status> on <method> <path>`) so a caller that
 * naively forwards `err.message` straight to an HTTP client response never
 * leaks schema/query/row details. The raw PostgREST response body (up to
 * 200 chars) is only on `.detail`, for callers that explicitly want it —
 * server-side logging, or an internal status persisted for the admin UI.
 */
class PgrestError extends Error {
  readonly status: number
  readonly detail: string

  constructor(status: number, method: string, pathAndQuery: string, detail: string) {
    super(`PostgREST ${status} on ${method} ${pathAndQuery}`)
    this.name = 'PgrestError'
    this.status = status
    this.detail = detail
  }
}

/**
 * Hard cap on every PostgREST round-trip. These are CRUD calls against the
 * gpu1 perimeter — 30s is already generous (the repo's longest external call,
 * the architect OpenAI request, caps at 60s; GitHub calls cap at 15s). Without
 * it, a hung PostgREST would block every route that shares this helper.
 */
const PGREST_TIMEOUT_MS = 30_000

/**
 * Fetch against a PostgREST table/view, service_role, `Prefer:
 * return=representation` so inserts/updates hand back the persisted row(s).
 * Fail-closed: throws (never fabricates data) if the backend isn't live or
 * PostgREST returns a non-OK status. A request that exceeds
 * PGREST_TIMEOUT_MS is aborted and rethrown as a PgrestError(504) so callers
 * classify it exactly like any other backend failure (generic 502 at the
 * route, detail via pgrestDetail() for server logs).
 */
export async function pgrest<T = Record<string, unknown>[]>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  pathAndQuery: string,
  body?: unknown
): Promise<T> {
  const { base, key } = requireBackend()
  let res: Response
  try {
    res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(PGREST_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new PgrestError(504, method, pathAndQuery, `request timed out after ${PGREST_TIMEOUT_MS}ms`)
    }
    throw err
  }
  if (!res.ok) {
    throw new PgrestError(res.status, method, pathAndQuery, (await res.text()).slice(0, 200))
  }
  if (res.status === 204) return [] as unknown as T
  const text = await res.text()
  if (!text) return [] as unknown as T
  return JSON.parse(text) as T
}

/** Best-effort detail extraction: PgrestError.detail if available, else `.message`. */
export function pgrestDetail(err: unknown): string {
  if (err instanceof PgrestError) return err.detail
  return err instanceof Error ? err.message : String(err)
}

/** snake_case → camelCase (top-level only; jsonb payloads are already camelCase). */
export function camelRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = v
  }
  return out as T
}

/** camelRow() mapped over a row array. */
export const camelRows = <T>(rows: Record<string, unknown>[]): T[] => rows.map((r) => camelRow<T>(r))
