/**
 * Shared SSRF guard for every outbound HTTP read in the platform.
 *
 * WHY this file exists: the guard used to live in TWO ~45-line copies that were
 * rigorously parallel — `http_get` in `./tool-registry.mjs` and
 * `HttpMarketProvider.fetchJson` in
 * `../lib/agent-mission-control/market/provider.ts`. They had already drifted,
 * and on the WRONG side of the risk: the market copy validated the URL scheme
 * (http/https) at config time AND on every redirect hop, while `http_get` —
 * the tool whose URL an LLM chooses — validated it nowhere. Hardening on the
 * least-exposed path is exactly the failure mode duplicated security code
 * produces. There is now one implementation, so a hardening applies to both.
 *
 * The policy difference between the two callers (a single PINNED host for the
 * market provider vs. a per-copilot multi-host allowlist for `http_get`) is a
 * PARAMETER (`allowedHosts`), not a reason to fork the code.
 *
 * The guard, in full:
 *   1. The URL must parse as an absolute URL.
 *   2. Its scheme must be http: or https: — never file:, data:, gopher:, ftp:…
 *   3. Its host must be in `allowedHosts` (when a list is supplied).
 *   4. `fetch` auto-redirect is DISABLED (`redirect: 'manual'`), because
 *      auto-follow only ever validates the INITIAL host: an allowed host that
 *      302s to an internal target (cloud metadata, admin panel…) would walk
 *      straight through the guard. Every hop is walked by hand and re-checked
 *      against rules 1-3 before it is followed, up to MAX_HTTP_REDIRECTS.
 *   5. Every refusal, timeout and network error FAILS CLOSED into a typed
 *      `{ ok: false, code, reason }` result — this module never throws, so a
 *      caller can always map a refusal onto its own contract (a JSON tool
 *      result, an UNAVAILABLE provenance) without a try/catch.
 *
 * FORMAT: `.mjs`, deliberately. The tool registry runs inside the separate
 * LangGraph process, which has no `server-only` and no TS build step. The
 * "import an .mjs from TypeScript" precedent already exists in the repo
 * (`tool-handlers.ts` imports `draft-spec.mjs`).
 */

/** Max redirect hops any guarded fetch will follow before giving up. */
export const MAX_HTTP_REDIRECTS = 3

/** HTTP statuses that carry a `location` we may follow. */
const REDIRECT_STATUSES = [301, 302, 303, 307, 308]

/**
 * Why a guarded call was refused. Callers switch on this instead of parsing
 * `reason` prose, so refusal semantics survive a wording change.
 *
 * @typedef {'invalid-url'
 *   | 'disallowed-scheme'
 *   | 'host-not-allowed'
 *   | 'redirect-invalid-url'
 *   | 'redirect-disallowed-scheme'
 *   | 'redirect-host-not-allowed'
 *   | 'too-many-redirects'
 *   | 'timeout'
 *   | 'network-error'} HttpGuardCode
 */

/**
 * @typedef {{ ok: false, code: HttpGuardCode, reason: string, host: string | null }} HttpGuardRejection
 */

/**
 * @typedef {{ ok: true, url: URL, host: string }} HttpUrlAccepted
 */

/**
 * Validate a URL against the guard's rules 1-3. Never throws.
 *
 * Used on its own for CONFIG validation (where the caller derives the pin from
 * the URL itself and so passes `allowedHosts: null`), and internally for every
 * redirect hop.
 *
 * @param {string} raw the URL to validate (absolute, or relative when `base` is given)
 * @param {readonly string[] | null} [allowedHosts] hosts allowed to be reached;
 *   `null`/omitted checks the scheme only and leaves the host to the caller.
 *   An EMPTY array allows nothing (fail closed) — it is not "no restriction".
 * @param {string} [base] base URL a relative `raw` resolves against (redirect hops)
 * @returns {HttpUrlAccepted | HttpGuardRejection}
 */
export function validateHttpUrl(raw, allowedHosts = null, base = undefined) {
  /** @type {URL} */
  let parsed
  try {
    parsed = base === undefined ? new URL(raw) : new URL(raw, base)
  } catch {
    return {
      ok: false,
      code: 'invalid-url',
      reason: `'${raw}' is not a parseable absolute URL`,
      host: null,
    }
  }
  // Rule 2 — the hardening that existed on only one of the two copies.
  // Checked BEFORE the host check: a `file:` or `data:` URL has an empty host,
  // so a scheme-blind guard would report the misleading "host not allowed".
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      code: 'disallowed-scheme',
      reason: `scheme must be http or https, got '${parsed.protocol}'`,
      host: parsed.host || null,
    }
  }
  // `URL` lowercases the host it parses, but an allowlist entry typed in the
  // dashboard may not be. Comparing raw would make an entry like
  // `API.EXAMPLE.COM` match nothing — a silently inoperative allowlist, which
  // fails closed but looks configured.
  if (
    allowedHosts !== null &&
    !allowedHosts.some((allowed) => String(allowed).trim().toLowerCase() === parsed.host)
  ) {
    return {
      ok: false,
      code: 'host-not-allowed',
      reason: `host '${parsed.host}' is not allowed (allowed: ${allowedHosts.join(', ') || 'none'})`,
      host: parsed.host,
    }
  }
  return { ok: true, url: parsed, host: parsed.host }
}

/** Re-map a hop rejection onto its redirect-specific code + prose. */
function asRedirectRejection(rejection, allowedHosts) {
  if (rejection.code === 'invalid-url') {
    return {
      ok: false,
      code: /** @type {HttpGuardCode} */ ('redirect-invalid-url'),
      reason: `redirect target is not a parseable URL: ${rejection.reason}`,
      host: null,
    }
  }
  if (rejection.code === 'disallowed-scheme') {
    return {
      ok: false,
      code: /** @type {HttpGuardCode} */ ('redirect-disallowed-scheme'),
      reason: `redirect to disallowed scheme: ${rejection.reason}`,
      host: rejection.host,
    }
  }
  return {
    ok: false,
    code: /** @type {HttpGuardCode} */ ('redirect-host-not-allowed'),
    reason: `redirect to disallowed host '${rejection.host}' (allowed: ${allowedHosts.join(', ') || 'none'})`,
    host: rejection.host,
  }
}

/**
 * A guarded call that reached a non-redirect response. `status`/`httpOk` are
 * reported rather than judged: `http_get` wants the body of a 404 too, while
 * the market provider treats any non-2xx as UNAVAILABLE. Judging the status
 * here would force one of those two contracts onto the other.
 *
 * @typedef {{ ok: true, status: number, httpOk: boolean, body: unknown, host: string, finalUrl: string }} HttpGuardSuccess
 */

/**
 * Fetch `rawUrl` under the full guard, following redirects by hand.
 *
 * The body is read through the caller's `readBody` INSIDE the guard's timeout
 * and try/catch, so a socket that stalls mid-body still aborts and a malformed
 * payload still fails closed as `network-error` instead of throwing out.
 *
 * @param {string} rawUrl
 * @param {{
 *   allowedHosts: readonly string[],
 *   timeoutMs: number,
 *   readBody: (res: Response) => Promise<unknown>,
 *   headers?: Record<string, string>,
 *   maxRedirects?: number,
 * }} options
 * @returns {Promise<HttpGuardSuccess | HttpGuardRejection>}
 */
export async function guardedFetch(rawUrl, options) {
  const { allowedHosts, timeoutMs, readBody, headers = {} } = options
  const maxRedirects = options.maxRedirects ?? MAX_HTTP_REDIRECTS

  // FAIL CLOSED before any socket is opened: a refused URL never reaches fetch.
  const start = validateHttpUrl(rawUrl, allowedHosts)
  if (!start.ok) return start

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let current = start.url.toString()
    let host = start.host
    for (let hop = 0; hop < maxRedirects; hop++) {
      const res = await fetch(current, {
        headers,
        signal: controller.signal,
        cache: 'no-store',
        // Rule 4 — auto-follow would validate the initial host ONLY.
        redirect: 'manual',
      })
      const location = res.headers.get('location')
      if (REDIRECT_STATUSES.includes(res.status) && location) {
        // Re-validate the hop against the SAME rules as the initial URL.
        const next = validateHttpUrl(location, allowedHosts, current)
        if (!next.ok) return asRedirectRejection(next, allowedHosts)
        current = next.url.toString()
        host = next.host
        continue
      }
      return {
        ok: true,
        status: res.status,
        httpOk: res.ok,
        body: await readBody(res),
        host,
        finalUrl: current,
      }
    }
    return {
      ok: false,
      code: 'too-many-redirects',
      reason: `too many redirects (> ${maxRedirects})`,
      host,
    }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return {
      ok: false,
      code: aborted ? 'timeout' : 'network-error',
      reason: aborted
        ? `timeout after ${timeoutMs}ms`
        : e instanceof Error
          ? e.message
          : String(e),
      host: start.host,
    }
  } finally {
    clearTimeout(timer)
  }
}
