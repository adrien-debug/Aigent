/**
 * Tool Builder — the mission state machine that turns a capability need into a
 * CERTIFIED tool (AIGENT-CORE-FACTORY-035, brique Tool Builder).
 *
 * The canonical registry already models a `ToolCertification` ('certified' |
 * 'draft' | 'deprecated'), but until now it was inert: every tool was
 * hand-written as `certified` with no proof. The doctrine this closes: a tool is
 * `certified` because a TEST PROVED it, not because someone typed the literal.
 *
 * This module owns the lifecycle DRAFT → IMPLEMENTING → TESTING → CERTIFIED
 * (and the failure/retirement branches), and — critically — `certifyMission`
 * refuses to reach CERTIFIED unless it is handed real, passing test evidence.
 * A build that never ran its tests, or whose tests failed, cannot certify.
 *
 * PURE + ISOMORPHIC: no server-only import, no IO. The state machine is a pure
 * reducer over evidence; running the actual sandbox test lives in the caller
 * (tool-builder/sandbox.ts) so this stays deterministically testable.
 */

import type { ToolKind, ToolRisk } from '../registry/tools'

/** Lifecycle of a tool BUILD (distinct from the tool's registry certification). */
export type ToolBuildState =
  | 'DRAFT' // spec captured, nothing generated yet
  | 'IMPLEMENTING' // code/spec being produced
  | 'TESTING' // tests written, not yet proven
  | 'CERTIFIED' // tests PROVED it — publishable
  | 'REJECTED' // failed a gate (test/security) — not publishable
  | 'DEPRECATED' // retired after having been certified

/** The specification an author gives the builder for a new LOCAL tool. */
export interface ToolBuildSpec {
  /** Proposed stable id (snake_case). */
  id: string
  version: string
  label: string
  summary: string
  /** Only 'local-deterministic' is fully supported by the builder today. */
  kind: ToolKind
  mutates: boolean
  risk: ToolRisk
  requiresConfirmation: boolean
  secretRefs: ReadonlyArray<string>
}

/** Evidence that the tool's own tests actually ran and their outcome. */
export interface ToolTestEvidence {
  ran: boolean
  passed: number
  failed: number
  /** Free-form log line(s) for the operator; never secrets. */
  detail?: string
}

export interface ToolBuildMission {
  spec: ToolBuildSpec
  state: ToolBuildState
  /** Populated once tests have run (TESTING onward). null before. */
  evidence: ToolTestEvidence | null
  /** Machine-readable reason when REJECTED. */
  rejectionReason: string | null
}

const ID_RE = /^[a-z][a-z0-9_]*$/
const SEMVER_RE = /^\d+\.\d+\.\d+$/
const SECRET_REF_RE = /^[A-Z][A-Z0-9_]*$/

/**
 * Validate a spec before anything is generated. Returns the list of problems
 * (empty ⇒ valid). A spec that fails this can never leave DRAFT.
 */
export function validateToolSpec(spec: ToolBuildSpec): string[] {
  const problems: string[] = []
  if (!ID_RE.test(spec.id)) problems.push(`id "${spec.id}" must be snake_case (^[a-z][a-z0-9_]*$)`)
  if (!SEMVER_RE.test(spec.version)) problems.push(`version "${spec.version}" is not semver`)
  if (!spec.label.trim()) problems.push('label is required')
  if (!spec.summary.trim()) problems.push('summary is required')
  if (spec.kind !== 'local-deterministic') {
    // The builder can only fully generate + sandbox-test a pure local tool today.
    // Other kinds (http/db/repo) need adapters/secrets the sandbox can't safely run.
    problems.push(`kind "${spec.kind}" is not buildable by the Tool Builder yet (only local-deterministic)`)
  }
  if (spec.kind === 'local-deterministic' && spec.mutates) {
    problems.push('a local-deterministic tool cannot mutate state (mutates must be false)')
  }
  for (const ref of spec.secretRefs) {
    if (!SECRET_REF_RE.test(ref)) problems.push(`secretRef "${ref}" is not an UPPER_SNAKE env reference`)
  }
  // A local tool has no external dependency, so it must declare no secrets.
  if (spec.kind === 'local-deterministic' && spec.secretRefs.length > 0) {
    problems.push('a local-deterministic tool must not require secrets')
  }
  return problems
}

/** Open a mission from a spec. Invalid spec ⇒ REJECTED immediately (fail-closed). */
export function startToolBuild(spec: ToolBuildSpec): ToolBuildMission {
  const problems = validateToolSpec(spec)
  if (problems.length > 0) {
    return { spec, state: 'REJECTED', evidence: null, rejectionReason: problems.join('; ') }
  }
  return { spec, state: 'DRAFT', evidence: null, rejectionReason: null }
}

/** DRAFT → IMPLEMENTING. Only a valid DRAFT may advance. */
export function beginImplementing(m: ToolBuildMission): ToolBuildMission {
  if (m.state !== 'DRAFT') return m
  return { ...m, state: 'IMPLEMENTING' }
}

/** IMPLEMENTING → TESTING. The code/spec is ready; tests are about to run. */
export function beginTesting(m: ToolBuildMission): ToolBuildMission {
  if (m.state !== 'IMPLEMENTING') return m
  return { ...m, state: 'TESTING' }
}

/**
 * TESTING → CERTIFIED, but ONLY on real passing evidence. This is the whole
 * point of the machine: certification is EARNED by proof, never asserted.
 *   - evidence must show tests actually RAN,
 *   - at least one test passed,
 *   - zero failed.
 * Anything else ⇒ REJECTED with a reason. A mission not in TESTING is untouched.
 */
export function certifyMission(m: ToolBuildMission, evidence: ToolTestEvidence): ToolBuildMission {
  if (m.state !== 'TESTING') return m
  if (!evidence.ran) {
    return { ...m, evidence, state: 'REJECTED', rejectionReason: 'tests never ran — cannot certify unproven tool' }
  }
  if (evidence.failed > 0) {
    return { ...m, evidence, state: 'REJECTED', rejectionReason: `${evidence.failed} test(s) failed` }
  }
  if (evidence.passed < 1) {
    return { ...m, evidence, state: 'REJECTED', rejectionReason: 'no passing test — certification requires proof' }
  }
  return { ...m, evidence, state: 'CERTIFIED', rejectionReason: null }
}

/** CERTIFIED → DEPRECATED. Retire a previously-certified tool. */
export function deprecateMission(m: ToolBuildMission): ToolBuildMission {
  if (m.state !== 'CERTIFIED') return m
  return { ...m, state: 'DEPRECATED' }
}

/** True iff the mission earned certification (publishable into the registry). */
export function isCertified(m: ToolBuildMission): boolean {
  return m.state === 'CERTIFIED'
}

