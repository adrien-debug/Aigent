import 'server-only'

import { authenticateInstallation } from './consumer-installations'
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
// Tenant resolution — CENTRALIZED. Every /api/runtime/v1/** route calls
// `resolveRuntimeTenant` and nothing else derives tenant scope. Two callers
// deriving "who is this" independently is exactly how two systems drift apart
// (AGENTS.md: "ne jamais recalculer ... dans une route").
// ---------------------------------------------------------------------------

/**
 * A resolved tenant identity for one request.
 *
 *  - `kind: 'installation'` — a per-installation token (consumer_installations,
 *    migration 0045) authenticated successfully. `projectId` is the tenant
 *    boundary: every route MUST filter its data access to this project and
 *    treat any other project's rows as nonexistent (404, never 403 — see
 *    `resolveRuntimeTenant`'s doc for why).
 *  - `kind: 'legacy-unscoped'` — the single shared `AIGENT_RUNTIME_API_TOKEN`
 *    matched. This is the PRE-EXISTING global token (TradeAgent's Bitcoin
 *    Advisory uses it today) kept for backward compatibility. It is an
 *    OPERATOR-GRADE credential, not a tenant credential: `projectId: null`
 *    means "not scoped to one tenant", and a route seeing this kind may serve
 *    the full fleet exactly as it does today. New consumers should be
 *    provisioned an installation token instead — this path is compatibility,
 *    not the intended shape going forward.
 */
export type RuntimeTenant =
  | { kind: 'installation'; projectId: string; installationId: string }
  | { kind: 'legacy-unscoped'; projectId: null; installationId: null }

export type RuntimeTenantResult = { ok: true; tenant: RuntimeTenant } | { ok: false; status: 401 | 503; error: string }

/**
 * Resolve the calling tenant for one `/api/runtime/v1/**` request. Call this
 * FIRST, before any DB read — fail-closed, same shape as `requireRuntimeApiAuth`.
 *
 * Two credential forms are accepted, tried in this order:
 *
 *  1. Installation token — `x-aigent-installation-id` header naming the
 *     installation, plus a bearer/`x-aigent-runtime-token` token that must hash
 *     to that installation's `token_hash` in `consumer_installations` AND be
 *     `status = 'active'`. This is the scoped, tenant-aware path: the
 *     resolution reuses `authenticateInstallation` (consumer-installations.ts)
 *     rather than re-implementing hash/compare/revocation-check here.
 *
 *     An installation whose `project_id` is null (UNPROVISIONED — a row that
 *     predates migration 0045's `project_id` column) is refused: a tenant
 *     identity with no provable project can grant no scoped access. Fail
 *     closed, never treat null as "sees everything".
 *
 *  2. Legacy shared token — `AIGENT_RUNTIME_API_TOKEN`, exactly the
 *     pre-existing global credential. Kept so the existing caller (TradeAgent's
 *     Bitcoin Advisory) does not break. Resolves to `legacy-unscoped`.
 *
 * If neither credential is present or valid: 401. If the runtime API has no
 * configured credential at all (`AIGENT_RUNTIME_API_TOKEN` unset AND no
 * installation-token header supplied), routes that need backend config still
 * answer 503 via their own checks — this function returns 401 for a bad/absent
 * credential and never leaks which of the two paths was attempted.
 */
export async function resolveRuntimeTenant(request: Request): Promise<RuntimeTenantResult> {
  const installationId = request.headers.get('x-aigent-installation-id')?.trim() || null
  const installationToken = extractBearerToken(request, 'x-aigent-runtime-token')

  if (installationId) {
    // An installation id was presented: this request claims the scoped path.
    // Never silently fall through to the legacy token on failure — that would
    // let a caller probe for the weaker credential.
    const installation = await authenticateInstallation(installationToken, installationId)
    if (!installation) {
      return { ok: false, status: 401, error: 'unauthorized' }
    }
    if (!installation.projectId) {
      // UNPROVISIONED (pre-migration row, or never assigned a project). Fail
      // closed rather than guessing a scope.
      return { ok: false, status: 401, error: 'unauthorized' }
    }
    return {
      ok: true,
      tenant: { kind: 'installation', projectId: installation.projectId, installationId: installation.id },
    }
  }

  // Fall back to the legacy shared operator token.
  const legacy = requireRuntimeApiAuth(request)
  if (!legacy.ok) {
    return legacy
  }
  return { ok: true, tenant: { kind: 'legacy-unscoped', projectId: null, installationId: null } }
}

/**
 * True when `tenant` may see/act on a row belonging to `projectId`.
 *
 * `legacy-unscoped` sees every project — the compatibility contract for the
 * pre-existing global token. An `installation` tenant sees only its own
 * project. `resourceProjectId === null` (a row with no resolved project) is
 * never visible to a scoped tenant: a null project is not "everyone's", it is
 * unresolved, and unresolved data must not leak across a tenant boundary.
 */
export function tenantCanSeeProject(tenant: RuntimeTenant, resourceProjectId: string | null): boolean {
  if (tenant.kind === 'legacy-unscoped') return true
  return resourceProjectId !== null && resourceProjectId === tenant.projectId
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
