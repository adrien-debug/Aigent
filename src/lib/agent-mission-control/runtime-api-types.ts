import 'server-only'

import { extractBearerToken, timingSafeEqual } from './bearer-token-auth'
import type { AgentRunStatus } from './types'

/**
 * Runtime Registry Contract v1 (AIG-RUNTIME-001) — shared types + auth for
 * `/api/runtime/v1/**`.
 *
 * This is a SEPARATE trust boundary from the AMC admin surface
 * (`/api/agent-ops/**`, guarded by src/proxy.ts's session/AMC_API_KEY gate)
 * and from the telemetry ingestion endpoint (`/api/runtime-telemetry`,
 * guarded by AIGENT_RUNTIME_TELEMETRY_TOKEN). This one is a *registry read +
 * run-control* surface consumed machine-to-machine by a deployed consumer
 * repo's runtime (e.g. Real Estate Agent), not by an AMC operator and not by
 * a generated agent's best-effort telemetry beacon. It gets its own
 * dedicated bearer token — AIGENT_RUNTIME_API_TOKEN — never AMC_API_KEY,
 * never AIGENT_RUNTIME_TELEMETRY_TOKEN. Mirrors the extractToken/
 * timingSafeEqual pattern in src/app/api/runtime-telemetry/route.ts.
 *
 * Every route under src/app/api/runtime/v1/** MUST call
 * `requireRuntimeApiAuth(request)` FIRST, before any DB access — fail-closed:
 * missing config → 503, missing/invalid token → 401, generic body, nothing
 * ever echoes the provided token.
 *
 * No real agent exists yet in the DB for Real Estate Agent (or any other
 * consumer project) — route handlers built on top of this contract return an
 * empty list / clean 404, never a fabricated/mock agent.
 */

// ---------------------------------------------------------------------------
// Domain type — EXACT shape required by the contract.
// ---------------------------------------------------------------------------

/** Contract version. Consumers pin this; a breaking change bumps the major. */
export const RUNTIME_CONTRACT_VERSION = '1.1.0'

/**
 * One agent as published to a consumer runtime.
 *
 * Mirrors the canonical `AvailableAgent` derivation (available-agents.ts) —
 * the same one the catalogue, the counters and the run gate use. It is NOT a
 * second source of truth: a consumer must never re-derive whether an agent may
 * run, because that is exactly how two systems drift apart.
 *
 * `executable` is the field that predicts a run. `status` alone does not:
 * an agent can be `active` and still declare a tool no handler backs.
 * `nonExecutableReasons` is human-readable and safe to display — it never
 * carries an internal id, a stack, or a secret.
 */
export type PublishedAgent = {
  id: string
  slug: string
  name: string
  description: string | null
  projectKey: string | null
  version: string | null
  /** Canonical availability, verbatim from the catalogue derivation. */
  status: 'active' | 'inactive' | 'degraded' | 'unavailable'
  /** True only when a run would actually be accepted right now. */
  executable: boolean
  /** Why not, in plain words. Empty when `executable` is true. */
  nonExecutableReasons: string[]
  provider: string | null
  configuredModel: string | null
  /** Model a real run PROVED. Null when never verified — never a guess. */
  executedModel: string | null
  runtime: string | null
  toolCount: number
  /** Declared tools with no registered handler. Non-empty ⇒ degraded. */
  unresolvedToolCount: number
  capabilities: string[]
  readOnly: boolean
  requiresHumanApproval: boolean
  lastRunAt: string | null
  lastRunStatus: string | null
  lastRunCostUsd: number | null
  updatedAt: string | null
}

// ---------------------------------------------------------------------------
// Run + event types (registry surface — run lifecycle, HITL resume, events).
// ---------------------------------------------------------------------------

export type RuntimeRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_on_input'
  | 'completed'
  | 'failed'
  | 'cancelled'

/**
 * Map Aigent's INTERNAL run status onto the published RuntimeRunStatus contract.
 * The two vocabularies differ, and a consumer's contract-typed SDK cannot parse
 * an internal value (`needs-confirmation`, `blocked`) — so every `/runtime/v1`
 * response that carries a run status MUST route through this, never emit
 * `result.status` verbatim. Exhaustive over AgentRunStatus so a new internal
 * status fails to typecheck here rather than leaking raw.
 *
 *   completed          -> completed
 *   failed             -> failed
 *   blocked            -> failed            (a guardrail refused it — not success)
 *   needs-confirmation -> waiting_on_input  (paused for human approval, not done)
 *   running            -> running
 */
export function toRuntimeRunStatus(internal: AgentRunStatus): RuntimeRunStatus {
  switch (internal) {
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'blocked':
      return 'failed'
    case 'needs-confirmation':
      return 'waiting_on_input'
    case 'running':
      return 'running'
  }
}

// ---------------------------------------------------------------------------
// Auth — service-to-service bearer token, fail-closed.
// ---------------------------------------------------------------------------

export type RuntimeAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string }

/**
 * Fail-closed service-to-service auth gate for every `/api/runtime/v1/**`
 * route. Call this FIRST, before touching any DB/backend — a route MUST
 * return the mapped status immediately when `ok` is false, never fall
 * through to a data lookup.
 *
 *  - AIGENT_RUNTIME_API_TOKEN absent → 503 (not configured, not a caller error).
 *  - Token missing/mismatched      → 401 (generic, token never echoed/logged).
 */
export function requireRuntimeApiAuth(request: Request): RuntimeAuthResult {
  const expectedToken = process.env.AIGENT_RUNTIME_API_TOKEN
  if (!expectedToken) {
    return { ok: false, status: 503, error: 'runtime registry API is not configured' }
  }
  const providedToken = extractBearerToken(request, 'x-aigent-runtime-token')
  if (!providedToken || !timingSafeEqual(providedToken, expectedToken)) {
    return { ok: false, status: 401, error: 'unauthorized' }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Id shape guards — mirror the bounded lowercase-alnum-hyphen convention
// used across agent-ops routes (projects/[id], tools/[toolId], etc.).
// ---------------------------------------------------------------------------

const PROJECT_KEY_RE = /^[a-z0-9-]{1,200}$/
const AGENT_ID_RE = /^[a-z0-9-]{1,200}$/
const RUN_ID_RE = /^[a-z0-9-]{1,200}$/

export function isValidProjectKey(value: string): boolean {
  return typeof value === 'string' && PROJECT_KEY_RE.test(value)
}

export function isValidAgentId(value: string): boolean {
  return typeof value === 'string' && AGENT_ID_RE.test(value)
}

export function isValidRunId(value: string): boolean {
  return typeof value === 'string' && RUN_ID_RE.test(value)
}
