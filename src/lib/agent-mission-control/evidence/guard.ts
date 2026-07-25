/**
 * AIGENT-DETERMINISTIC-EVIDENCE-001 — fail-closed activation guard for the
 * deterministic execution adapter.
 *
 * The deterministic adapter produces $0, reproducible evidence WITHOUT a billed
 * LLM call. That is exactly what a proof or a test wants — and exactly what must
 * NEVER run in a production user context, where it could manufacture green
 * evidence for a real agent. This module is the single chokepoint that decides
 * whether a deterministic adapter may be constructed at all.
 *
 * The rule is fail-closed and driven ONLY by server-side signals, never by
 * request data:
 *
 *   1. PRODUCTION ALWAYS REFUSES. If the runtime looks production — or if we
 *      cannot POSITIVELY prove it is not — no deterministic adapter is built, no
 *      matter how the activation was requested (env var, API param, manifest,
 *      user payload, persisted config). None of those five vectors is even
 *      consulted here: the decision keys off NODE_ENV / VITEST / CI / an explicit
 *      server-side opt-in, so a value a user can set can never flip it.
 *   2. OUTSIDE PRODUCTION, ALLOW ONLY A RECOGNISED CONTEXT — tests, CI, or an
 *      explicit local/proof-script opt-in. An unrecognised non-production runtime
 *      still refuses (fail-closed), so "not production" alone is not enough.
 *
 * Mirrors the two-way fail-closed shape of agent-server-endpoint.mjs (refuse a
 * local endpoint in prod AND a remote one in dev). No secret is read; pure of I/O.
 */

import {
  EVIDENCE_MODE_DB_LABEL,
  type EvidenceExecutionAdapter,
} from './execution-adapter'

/** The ways a caller could try to turn on the deterministic executor. All refused in prod. */
export type DeterministicActivationSource =
  | 'env' // an environment variable
  | 'api-param' // a query/body parameter on an API route
  | 'manifest' // a field baked into an agent manifest
  | 'payload' // arbitrary user request payload
  | 'config' // persisted configuration (DB / settings row)
  | 'proof-script' // a trusted server-side proof script opting in explicitly
  | 'test' // a unit/integration test

/** Thrown when a deterministic adapter is requested in a context that forbids it. */
export class DeterministicEvidenceForbiddenError extends Error {
  readonly source: DeterministicActivationSource
  constructor(message: string, source: DeterministicActivationSource) {
    super(message)
    this.name = 'DeterministicEvidenceForbiddenError'
    this.source = source
  }
}

type EnvLike = Record<string, string | undefined>

/**
 * Is the runtime production? FAIL-CLOSED: returns true unless it can positively
 * prove otherwise. `NODE_ENV === 'production'` is production; so is an UNKNOWN /
 * unset NODE_ENV (a bare `tsx` script that never declared its environment must
 * not be assumed safe). Only the two known non-production values —
 * 'development' and 'test' — return false.
 */
export function isProductionRuntime(env: EnvLike = process.env): boolean {
  const nodeEnv = env.NODE_ENV
  if (nodeEnv === 'development' || nodeEnv === 'test') return false
  return true
}

/**
 * A recognised NON-production context in which deterministic evidence is
 * legitimately produced. Ordered by how unambiguous the signal is:
 *   - VITEST / NODE_ENV=test → a test run,
 *   - CI → a continuous-integration run,
 *   - AIGENT_DETERMINISTIC_EVIDENCE=allow → an explicit opt-in a proof script or
 *     a deliberately-configured local dev sets on itself.
 * Anything else is not recognised. This is consulted ONLY after isProductionRuntime
 * has already returned false, so it can never override the production refusal.
 */
function recognisedContext(env: EnvLike): string | null {
  if (env.VITEST === 'true' || env.NODE_ENV === 'test') return 'test'
  if (env.CI === 'true' || env.CI === '1') return 'ci'
  if (env.AIGENT_DETERMINISTIC_EVIDENCE === 'allow') return 'explicit-opt-in'
  return null
}

/**
 * The one gate. Throws `DeterministicEvidenceForbiddenError` unless the current
 * runtime is a recognised, non-production context. Call it BEFORE constructing or
 * activating any deterministic adapter. `source` is recorded on the error only to
 * make the refusal legible — it is NOT consulted in the decision, by design: no
 * request-controlled value may influence whether the executor turns on.
 */
export function assertDeterministicEvidenceAllowed(
  source: DeterministicActivationSource,
  env: EnvLike = process.env
): void {
  if (isProductionRuntime(env)) {
    throw new DeterministicEvidenceForbiddenError(
      `deterministic evidence executor is forbidden in production (requested via ${source}); ` +
        `it is a $0 fixture path and must never manufacture evidence in a user context`,
      source
    )
  }
  const context = recognisedContext(env)
  if (context === null) {
    throw new DeterministicEvidenceForbiddenError(
      `deterministic evidence executor requires a recognised non-production context ` +
        `(a test run, CI, or an explicit AIGENT_DETERMINISTIC_EVIDENCE=allow opt-in); ` +
        `none was detected (requested via ${source})`,
      source
    )
  }
}

/**
 * Resolve which adapter a caller gets. The live adapter is ALWAYS available (it
 * is the safe default). A deterministic adapter is built by `makeDeterministic`
 * ONLY after the guard passes — so every one of the five activation vectors funnels
 * through the same production refusal, and the resolver itself never reads request
 * data to make the choice: the caller states `requested`, the environment decides
 * whether that request is honoured. This is the function the runners and the
 * activation-vector tests both use to prove "no source activates a fixture in prod".
 */
export function resolveEvidenceAdapter(args: {
  requested: 'live' | 'deterministic'
  source: DeterministicActivationSource
  live: EvidenceExecutionAdapter
  makeDeterministic: () => EvidenceExecutionAdapter
  env?: EnvLike
}): EvidenceExecutionAdapter {
  if (args.requested === 'live') return args.live
  assertDeterministicEvidenceAllowed(args.source, args.env)
  const adapter = args.makeDeterministic()
  if (adapter.label !== EVIDENCE_MODE_DB_LABEL.deterministic) {
    // Defensive: a deterministic adapter must be self-labelled as a fixture, or
    // it could persist rows indistinguishable from a billed run.
    throw new DeterministicEvidenceForbiddenError(
      `deterministic adapter must label itself '${EVIDENCE_MODE_DB_LABEL.deterministic}', got '${adapter.label}'`,
      args.source
    )
  }
  return adapter
}
