#!/usr/bin/env node
/**
 * Stack health checker — proves the dev stack is actually usable, not merely
 * listening. Pure Node, no deps. Run via `npm run health` (which supplies
 * .env.local through `node --env-file`).
 *
 * Why this exists (AIG-STABILIZATION-004): `npm run dev` runs Next and the
 * LangGraph Agent Server under one `concurrently`. LangGraph died with SIGTERM
 * while Next kept serving, so /admin answered 200 and the stack looked green
 * while every agent run was broken. A port-open probe would have agreed. So the
 * LangGraph check does NOT stop at liveness: it asserts the `agent_builder`
 * graph declared in langgraph.json is actually registered on the server. That
 * "live but graphless" state is the exact traitorous failure this targets, and
 * it is reported UNHEALTHY with that reason.
 *
 * NO FALSE GREEN is the whole contract:
 *   - a connection refusal, timeout, or 5xx is UNHEALTHY, never "probably fine";
 *   - missing env is UNHEALTHY with an explicit reason, never a silent pass;
 *   - every probe is bounded by AbortSignal.timeout so a hung backend fails
 *     loudly instead of hanging the check.
 *
 * ZERO BILLED TOKENS: the LangGraph probe only searches the assistant registry
 * (POST /assistants/search, the same call the app's langgraph-explorer makes).
 * It never creates a thread and never invokes a graph run, so no LLM is called.
 *
 * SECRETS: never printed. The PostgREST probe reports host-free latency only —
 * no URL, no key, not even in a failure reason (a credential-bearing URL is a
 * secret too). Failure reasons carry the status/cause, never the target.
 *
 * Exit code: 0 when every service is HEALTHY, 1 otherwise (so it composes into
 * a shell gate). `--json` emits a machine-readable object instead of the table.
 *
 * Importing this module runs nothing — main() is invoked only when the file is
 * executed directly, so the pure helpers below are unit-testable.
 */
import { pathToFileURL } from 'node:url'

import {
  localAgentServerUrl,
  resolveAgentServerUrl,
} from '../src/langgraph/agent-server-endpoint.mjs'

/** Bounded per-probe budget. A dev server slower than this is a failure. */
const NEXT_TIMEOUT_MS = 10_000
const LANGGRAPH_TIMEOUT_MS = 10_000
const PGREST_TIMEOUT_MS = 10_000

// Port de dev ABSOLU 3987, jamais 3000 ni 3210 (voir AGENTS.md). Aligné sur
// dev-stack.mjs via AIGENT_DEV_PORT ; HEALTH_NEXT_URL reste l'override complet.
const NEXT_URL =
  process.env.HEALTH_NEXT_URL ||
  `http://127.0.0.1:${Number(process.env.AIGENT_DEV_PORT) || 3987}/admin`
/** The same fail-closed local endpoint resolver used by agent runs. */
const LANGGRAPH_URL = resolveAgentServerUrl({
  ...process.env,
  NODE_ENV: 'development',
  LANGGRAPH_API_URL: localAgentServerUrl(process.env),
})
/** Graph id declared in langgraph.json — mirrors AGENT_BUILDER_GRAPH_ID. */
const GRAPH_ID = 'agent_builder'

/** Column widths for the aligned report. Name 12, status 11, then free detail. */
const NAME_WIDTH = 12
const STATUS_WIDTH = 11

export const HEALTHY = 'HEALTHY'
export const UNHEALTHY = 'UNHEALTHY'

/**
 * Classify one HTTP probe outcome.
 *
 * Healthy only on a real answer in the 2xx/3xx range: a 3xx is a genuine reply
 * from a live app (a dev route may redirect to a login), whereas 4xx/5xx and
 * any transport-level failure (refused, DNS, aborted) are unhealthy. `error`
 * takes precedence — if the request never completed there is no status to
 * trust.
 *
 * @param {{status?: number, error?: unknown}} result
 * @returns {{healthy: boolean, reason: string}}
 */
export function classifyHttpResult({ status, error } = {}) {
  if (error) {
    // Fixed vocabulary via the shared transport classifier, never the raw
    // message: every probe target is env-overridable, and Node puts the full
    // URL in some transport errors ("Failed to parse URL from https://host/…"),
    // which would print a configured host — a credential-bearing URL is a
    // secret too. One classifier for all probes, so the vocabularies cannot
    // drift apart.
    const { reason } = classifyTransportError(error)
    return { healthy: false, reason: reason === 'timed out' ? reason : `unreachable (${reason})` }
  }
  if (typeof status !== 'number') {
    return { healthy: false, reason: 'no response' }
  }
  if (status >= 200 && status < 400) {
    return { healthy: true, reason: String(status) }
  }
  return { healthy: false, reason: String(status) }
}

/**
 * Classify a transport-level failure into a FIXED vocabulary, deliberately
 * dropping the error message.
 *
 * Node's fetch failures carry the target in their text — a malformed
 * AMC_SUPABASE_URL produces "Failed to parse URL from https://<host>/rest/v1/…"
 * and a credential-bearing URL is itself a secret. Any probe whose target is a
 * remote, secret-bearing host MUST route through here rather than echoing
 * `error.message`, so the "no URL, no key, ever" contract above holds even on
 * the failure path.
 *
 * @param {unknown} error
 * @returns {{healthy: false, reason: 'timed out'|'connection refused'|'dns failure'|'transport error'}}
 */
export function classifyTransportError(error) {
  const name = error instanceof Error ? error.name : ''
  if (name === 'TimeoutError' || name === 'AbortError') {
    return { healthy: false, reason: 'timed out' }
  }
  // The useful signal lives in the cause's syscall code, never in the message.
  const err = error && typeof error === 'object' ? /** @type {any} */ (error) : {}
  const cause = err.cause && typeof err.cause === 'object' ? err.cause : {}
  const code =
    (typeof cause.code === 'string' && cause.code) || (typeof err.code === 'string' && err.code) || ''
  if (code === 'ECONNREFUSED') return { healthy: false, reason: 'connection refused' }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { healthy: false, reason: 'dns failure' }
  return { healthy: false, reason: 'transport error' }
}

/**
 * Decide, from a parsed POST /assistants/search response body, whether the
 * required graph is actually registered.
 *
 * This is the heart of the "no false green" contract: a LangGraph server that
 * outlived its graph answers 200 with an empty (or unrelated) array, and that
 * state must be UNHEALTHY. Anything that is not an array containing a row whose
 * `graph_id` matches is unhealthy — a null/object/string body means we could not
 * prove the graph, and unproven is never a pass.
 *
 * Exported and used by checkLangGraph itself, so the tested code is the shipped
 * code. Also imported by scripts/dev-stack.mjs to gate its readiness probe.
 *
 * @param {unknown} rows parsed response body
 * @param {string} graphId graph id that must be present
 * @returns {{healthy: boolean, reason: string}}
 */
export function classifyAssistantsSearch(rows, graphId) {
  if (!Array.isArray(rows)) {
    return { healthy: false, reason: `alive but assistants/search returned no list` }
  }
  const found = rows.some(
    (row) => row && typeof row === 'object' && row.graph_id === graphId
  )
  if (!found) {
    // Live but graphless — the exact failure mode this checker exists for.
    return { healthy: false, reason: `alive but graph ${graphId} absent` }
  }
  return { healthy: true, reason: `graph ${graphId} available` }
}

/**
 * Render one aligned report row. Trailing padding is trimmed so a detail-less
 * line (the verdict) has no ragged whitespace.
 *
 * @param {string} name service label
 * @param {string} status HEALTHY | UNHEALTHY | DEGRADED
 * @param {string} [detail] free-form right column
 */
export function formatStatusLine(name, status, detail = '') {
  return `${String(name).padEnd(NAME_WIDTH)}${String(status).padEnd(STATUS_WIDTH)}${detail}`.trimEnd()
}

/**
 * Aggregate per-service verdicts into the stack verdict. DEGRADED if ANY
 * service is unhealthy; HEALTHY only if all are. An empty list is DEGRADED:
 * checking nothing must never read as green.
 *
 * @param {Array<{healthy: boolean}>} services
 * @returns {'HEALTHY'|'DEGRADED'}
 */
export function aggregateVerdict(services) {
  if (!Array.isArray(services) || services.length === 0) return 'DEGRADED'
  return services.every((s) => s && s.healthy === true) ? 'HEALTHY' : 'DEGRADED'
}

/** Wall-clock ms for a probe, rounded — reported so a slow service is visible. */
function elapsedMs(startedAt) {
  return Math.round(performance.now() - startedAt)
}

/** NEXT — an existing route (/admin). Records status + latency. */
async function checkNext() {
  const startedAt = performance.now()
  let outcome
  try {
    const res = await fetch(NEXT_URL, {
      method: 'GET',
      redirect: 'manual', // a redirect IS an answer; don't follow it off-host
      cache: 'no-store',
      signal: AbortSignal.timeout(NEXT_TIMEOUT_MS),
    })
    outcome = classifyHttpResult({ status: res.status })
  } catch (error) {
    outcome = classifyHttpResult({ error })
  }
  const ms = elapsedMs(startedAt)
  return {
    name: 'NEXT',
    healthy: outcome.healthy,
    ms,
    // Same shape either way: the status code (or transport reason) then latency.
    detail: `${outcome.reason}  ${ms}ms`,
    reason: outcome.reason,
  }
}

/**
 * LANGGRAPH — two-stage. First liveness (GET /ok), then registry proof that
 * `agent_builder` exists. Port open or /ok alone is explicitly NOT enough.
 *
 * The registry call mirrors the SDK's assistants.search (POST /assistants/search
 * with a snake_case `graph_id` filter) and carries the same fail-closed
 * `x-agent-key` header the app sends, because langgraph.json declares an auth
 * hook. A 401/403 here means the server is up but we cannot prove the graph —
 * that is unhealthy, not a pass.
 */
async function checkLangGraph() {
  const startedAt = performance.now()
  const secret = process.env.LANGGRAPH_SERVER_SECRET?.trim()
  const headers = { 'Content-Type': 'application/json' }
  if (secret) headers['x-agent-key'] = secret

  // Stage 1 — liveness.
  try {
    const res = await fetch(`${LANGGRAPH_URL}/ok`, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(LANGGRAPH_TIMEOUT_MS),
    })
    const live = classifyHttpResult({ status: res.status })
    if (!live.healthy) {
      return {
        name: 'LANGGRAPH',
        healthy: false,
        ms: elapsedMs(startedAt),
        detail: `liveness /ok ${live.reason}`,
        reason: `liveness /ok ${live.reason}`,
      }
    }
  } catch (error) {
    const live = classifyHttpResult({ error })
    return {
      name: 'LANGGRAPH',
      healthy: false,
      ms: elapsedMs(startedAt),
      detail: `liveness /ok ${live.reason}`,
      reason: `liveness /ok ${live.reason}`,
    }
  }

  // Stage 2 — the graph must actually be registered. This is the check that
  // catches a server that survived its graph.
  try {
    const res = await fetch(`${LANGGRAPH_URL}/assistants/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ graph_id: GRAPH_ID, limit: 1, offset: 0 }),
      cache: 'no-store',
      signal: AbortSignal.timeout(LANGGRAPH_TIMEOUT_MS),
    })
    const search = classifyHttpResult({ status: res.status })
    if (!search.healthy) {
      const hint = res.status === 401 || res.status === 403 ? ' (LANGGRAPH_SERVER_SECRET rejected)' : ''
      return {
        name: 'LANGGRAPH',
        healthy: false,
        ms: elapsedMs(startedAt),
        detail: `assistants/search ${search.reason}${hint}`,
        reason: `assistants/search ${search.reason}${hint}`,
      }
    }
    // A body that is not JSON at all cannot prove the graph either.
    let rows
    try {
      rows = await res.json()
    } catch {
      rows = null
    }
    const registry = classifyAssistantsSearch(rows, GRAPH_ID)
    return {
      name: 'LANGGRAPH',
      healthy: registry.healthy,
      ms: elapsedMs(startedAt),
      detail: registry.reason,
      reason: registry.reason,
    }
  } catch (error) {
    const search = classifyHttpResult({ error })
    return {
      name: 'LANGGRAPH',
      healthy: false,
      ms: elapsedMs(startedAt),
      detail: `assistants/search ${search.reason}`,
      reason: `assistants/search ${search.reason}`,
    }
  }
}

/**
 * POSTGREST — smallest possible authenticated read against the gpu1 perimeter:
 * one id, one row. Missing env is an explicit UNHEALTHY, never a skip that
 * reads as green. Neither the URL nor the key ever reaches the output.
 */
async function checkPostgrest() {
  const base = process.env.AMC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!base || !key) {
    const missing = [!base && 'AMC_SUPABASE_URL', !key && 'SUPABASE_SERVICE_ROLE_KEY']
      .filter(Boolean)
      .join(', ')
    return {
      name: 'POSTGREST',
      healthy: false,
      ms: null,
      detail: `env missing: ${missing}`,
      reason: `env missing: ${missing}`,
    }
  }

  const startedAt = performance.now()
  try {
    const res = await fetch(`${base}/rest/v1/projects?select=id&limit=1`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, apikey: key, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(PGREST_TIMEOUT_MS),
    })
    const outcome = classifyHttpResult({ status: res.status })
    const ms = elapsedMs(startedAt)
    if (!outcome.healthy) {
      // Status only — the request URL carries the backend host, so it is never echoed.
      return {
        name: 'POSTGREST',
        healthy: false,
        ms,
        detail: `HTTP ${outcome.reason}  ${ms}ms`,
        reason: `HTTP ${outcome.reason}`,
      }
    }
    await res.text() // drain so the socket is released
    return { name: 'POSTGREST', healthy: true, ms, detail: `${ms}ms`, reason: 'ok' }
  } catch (error) {
    // Fixed vocabulary only: error.message would leak the backend host (and a
    // malformed URL leaks it verbatim), which the contract above forbids.
    const outcome = classifyTransportError(error)
    const ms = elapsedMs(startedAt)
    return {
      name: 'POSTGREST',
      healthy: false,
      ms,
      detail: `${outcome.reason}  ${ms}ms`,
      reason: outcome.reason,
    }
  }
}

async function main() {
  const asJson = process.argv.includes('--json')

  // Probes are independent; run them concurrently so the check costs the
  // slowest one rather than their sum.
  const services = await Promise.all([checkNext(), checkLangGraph(), checkPostgrest()])
  const verdict = aggregateVerdict(services)

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          verdict,
          checkedAt: new Date().toISOString(),
          services: services.map((s) => ({
            name: s.name,
            status: s.healthy ? HEALTHY : UNHEALTHY,
            healthy: s.healthy,
            ms: s.ms,
            reason: s.reason,
          })),
        },
        null,
        2
      )
    )
  } else {
    for (const s of services) {
      console.log(formatStatusLine(s.name, s.healthy ? HEALTHY : UNHEALTHY, s.detail))
    }
    console.log(formatStatusLine('STACK', verdict))
  }

  process.exit(verdict === 'HEALTHY' ? 0 : 1)
}

// Side-effecting entry point only when executed directly — importing this
// module for its pure helpers must never fire a network probe.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[health] unexpected failure:', err instanceof Error ? err.message : err)
    console.log(formatStatusLine('STACK', 'DEGRADED'))
    process.exit(1)
  })
}
