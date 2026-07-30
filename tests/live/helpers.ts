/**
 * Shared helpers for tests/live/** — the opt-in suite that hits the REAL
 * `npm run dev` stack (Next on :3987, LangGraph Agent Server on :2024), the
 * real gpu1 PostgREST backend, and real OpenAI.
 *
 * Every live test MUST call `requireLiveStack()` (or a narrower probe) at the
 * top and `return` early via `skipIfDown` when the stack isn't reachable —
 * these tests must SKIP cleanly, not fail noisily, when `npm run dev` isn't
 * running. This file has NO import of any `server-only` module (it talks to
 * the app over plain HTTP, exactly like a real client would), so it needs no
 * special vitest resolve conditions.
 */
import { env } from 'node:process'

/**
 * The ONLY port a live run may probe: `AIGENT_DEV_PORT`, default 3987 (see
 * scripts/dev-stack.mjs and AGENTS.md § "Port de dev").
 *
 * 3000/3001/3210 used to be probed as a fallback. That is worse than finding
 * nothing: those ports belong to OTHER Next projects on this machine, so a
 * fallback pointed the live suite at a neighbouring app and reported its
 * responses as Aigent's. A live test with no app running must fail loudly, not
 * quietly test someone else's server.
 */
const CANDIDATE_PORTS = [Number(process.env.AIGENT_DEV_PORT) || 3987]

let cachedBaseUrl: string | null | undefined

/**
 * Probe candidate ports for a live instance of THIS app (not just "a" Next
 * server) and cache the first one that responds. A bare port-open check is
 * NOT enough: dev machines routinely have unrelated projects bound to 3000 —
 * probing that port would silently run assertions against the wrong app and
 * either crash confusingly or (worse) report false failures. Instead we
 * probe the one behavior unique to this repo's proxy.ts: an unauthenticated
 * GET to /api/agent-ops/copilots returns EXACTLY 401 with the fail-closed
 * `{ ok: false, error: 'Authentication required' }` shape (see proxy.ts).
 * Returns null (never throws) when neither port serves that signature, so
 * callers skip cleanly. Cached for the process lifetime.
 */
export async function findAppBaseUrl(): Promise<string | null> {
  if (cachedBaseUrl !== undefined) return cachedBaseUrl
  for (const port of CANDIDATE_PORTS) {
    const url = `http://127.0.0.1:${port}`
    try {
      const res = await fetch(`${url}/api/agent-ops/copilots`, { signal: AbortSignal.timeout(1500) })
      if (res.status !== 401) continue
      const body = await res.json().catch(() => null)
      if (body && body.ok === false && typeof body.error === 'string') {
        cachedBaseUrl = url
        return url
      }
    } catch {
      // try next candidate
    }
  }
  cachedBaseUrl = null
  // HONESTY GUARD: a skipped live test still reports "passed" — a green run that
  // verified NOTHING is itself a silent false success, the very class of lie this
  // suite exists to catch. With LIVE_REQUIRED=1 (CI, or any time you actually mean
  // to verify), a missing stack THROWS instead of quietly passing.
  if (process.env.LIVE_REQUIRED === '1') {
    throw new Error(
      'LIVE_REQUIRED=1 but no Aigent app answered on ' +
        CANDIDATE_PORTS.join('/') +
        ' — run `npm run dev` first. Refusing to report a green run that verified nothing.'
    )
  }
  return null
}

/** True when the LangGraph Agent Server (:2024) responds. */
export async function isAgentServerUp(): Promise<boolean> {
  try {
    const res = await fetch('http://127.0.0.1:2024/ok', { signal: AbortSignal.timeout(1500) })
    return res.ok || res.status < 500
  } catch {
    try {
      // Some langgraphjs dev builds don't expose /ok; fall back to root.
      const res = await fetch('http://127.0.0.1:2024/', { signal: AbortSignal.timeout(1500) })
      return res.status < 500
    } catch {
      return false
    }
  }
}

export interface LiveStack {
  baseUrl: string
  amcApiKey: string
}

/**
 * Resolve everything a live test needs, or null when any prerequisite is
 * missing (app not running, AMC_API_KEY not set). Tests call this once and
 * skip via `if (!stack) return`.
 *
 * HONESTY GUARD: a skipped live test still reports "passed", which is itself a
 * silent false success — the exact class of lie this suite exists to catch (a
 * green run that verified NOTHING). Set `LIVE_REQUIRED=1` (CI, or any time you
 * actually mean to verify the stack) and a missing stack THROWS instead of
 * quietly passing. Without it, the skip stays convenient for local unit-only work.
 */
export async function resolveLiveStack(): Promise<LiveStack | null> {
  const baseUrl = await findAppBaseUrl()
  const amcApiKey = env.AMC_API_KEY
  const required = env.LIVE_REQUIRED === '1'

  if (!baseUrl || !amcApiKey) {
    if (required) {
      throw new Error(
        `LIVE_REQUIRED=1 but the live stack is unusable — ${
          !baseUrl ? 'the app is not reachable (run `npm run dev`)' : 'AMC_API_KEY is not set'
        }. Refusing to report a green run that verified nothing.`
      )
    }
    return null
  }
  return { baseUrl, amcApiKey }
}

/** Standard headers for an authenticated agent-ops API call (server-to-server key). */
export function amcHeaders(apiKey: string, extra?: Record<string, string>): Record<string, string> {
  return { 'x-amc-key': apiKey, 'Content-Type': 'application/json', ...extra }
}

/**
 * Minimal PostgREST GET against the same gpu1 perimeter the app uses —
 * needed so live tests can assert on rows the app itself wrote (e.g.
 * "does at least one tool_calls row exist for this run_id"), which no HTTP
 * route currently exposes directly.
 */
export async function pgrestGet<T = Record<string, unknown>[]>(pathAndQuery: string): Promise<T | null> {
  const base = env.AMC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return null
  try {
    const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
      headers: { Authorization: `Bearer ${key}`, apikey: key },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const text = await res.text()
    return text ? (JSON.parse(text) as T) : ([] as unknown as T)
  } catch {
    return null
  }
}

/** True when gpu1 PostgREST env is present (independent of the app being up). */
export function hasBackendEnv(): boolean {
  return Boolean(env.AMC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * Find a live copilot row that (a) runs on the langgraph runtime and (b) is
 * attached to a project with a repo, i.e. it should ALWAYS have repo tools
 * mounted per buildCopilotBehaviorConfig's guarantee. Returns null if none
 * found or the backend is unreachable. Prefers the two copilots named in the
 * task brief but falls back to a live query so this doesn't rot if ids change.
 */
export async function findRepoScopedLangGraphCopilot(): Promise<{
  id: string
  name: string
  repoFullName: string
} | null> {
  const preferredIds = ['copilot-power-ops-copilot-c57254ff', 'copilot-agent-builder-copilot-69d941fc']
  for (const id of preferredIds) {
    const rows = await pgrestGet<Record<string, unknown>[]>(
      `copilots?id=eq.${encodeURIComponent(id)}&select=id,name,runtime,project_id&runtime=eq.langgraph`
    )
    if (rows && rows.length > 0) {
      const projectId = rows[0].project_id as string | null
      if (!projectId) continue
      const projectRows = await pgrestGet<Record<string, unknown>[]>(
        `projects?id=eq.${encodeURIComponent(projectId)}&select=id,repo_full_name`
      )
      const repoFullName = projectRows?.[0]?.repo_full_name as string | undefined
      if (repoFullName) {
        return { id: rows[0].id as string, name: rows[0].name as string, repoFullName }
      }
    }
  }
  // Fallback: any langgraph copilot whose project has a repo.
  const rows = await pgrestGet<Record<string, unknown>[]>(
    'copilots?select=id,name,runtime,project_id&runtime=eq.langgraph&project_id=not.is.null'
  )
  if (!rows) return null
  for (const row of rows) {
    const projectId = row.project_id as string | null
    if (!projectId) continue
    const projectRows = await pgrestGet<Record<string, unknown>[]>(
      `projects?id=eq.${encodeURIComponent(projectId)}&select=id,repo_full_name`
    )
    const repoFullName = projectRows?.[0]?.repo_full_name as string | undefined
    if (repoFullName) return { id: row.id as string, name: row.name as string, repoFullName }
  }
  return null
}
