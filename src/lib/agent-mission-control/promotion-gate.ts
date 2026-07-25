/**
 * Agent Mission Control — Promotion Gate (server only).
 *
 * AIGENT-RUNTIME-PROMOTION-001. THE single authority for "may this candidate
 * version be promoted to production/active". It EXTENDS the existing controlled
 * release gate (release-gate.ts, 9 live checks) with the runtime-executability,
 * resolved+certified-tools, shadow-proof and replay-comparison checks, maps the
 * whole thing to the PASS/FAIL/NOT_CONFIGURED/INSUFFICIENT_EVIDENCE vocabulary,
 * and — the point of the whole mission — PERSISTS the evaluation so the atomic
 * RPC (`promote_copilot_version`, migration 0029) can re-read it and refuse to
 * reach ACTIVE without a fresh, passing one.
 *
 * Every check is re-read from LIVE data AT DECISION TIME. Nothing trusts a
 * stored `scores` blob or an administrative status. A missing required signal is
 * INSUFFICIENT_EVIDENCE (blocks), never fabricated into a pass.
 *
 * Never import from a client component (reads the service-role key).
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

import { evaluateReleaseGate } from './release-gate'
import { pgrest } from './postgrest'
import { isRuntimeExecutable } from './registry/runtimes'
import { getTool } from './registry/tools'
import { REGISTRY_HASH } from './registry'
import type { IsoTimestamp } from './types'

const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`

/** The four outcomes a promotion check (and the gate overall) can carry. */
export type PromotionCheckStatus = 'PASS' | 'FAIL' | 'NOT_CONFIGURED' | 'INSUFFICIENT_EVIDENCE'

export type PromotionCheckId =
  | 'release-gate' // the 9-check controlled release gate, rolled up
  | 'runtime-executable' // the version's runtime has a real engine
  | 'tools-resolved-certified' // every declared tool resolves to a certified registry tool
  | 'shadow-proof' // a shadow experiment proved the candidate (when required)
  | 'replay-comparison' // replay says the candidate is not worse (when required)

export interface PromotionCheck {
  id: PromotionCheckId
  label: string
  status: PromotionCheckStatus
  /** Human-readable observed value. */
  reason: string
  /** Id(s) of the persisted evidence this check read, if any. */
  evidenceRef: string | null
  /** Which table/module is the source of truth for this check. */
  sourceOfTruth: string
  evaluatedAt: IsoTimestamp
}

/** A policy telling the gate which optional-but-blocking evidence is REQUIRED. */
export interface PromotionPolicy {
  /** When true, a passing shadow experiment is mandatory. */
  requireShadow: boolean
  /** When true, a replay comparison that is not WORSE/INCONCLUSIVE is mandatory. */
  requireReplay: boolean
}

export const DEFAULT_PROMOTION_POLICY: PromotionPolicy = { requireShadow: false, requireReplay: false }

export interface PromotionGateResult {
  copilotId: string
  candidateVersionId: string
  runtime: string
  /** PASS only when every check is PASS. Any FAIL/INSUFFICIENT/NOT_CONFIGURED (on a required check) blocks. */
  overall: PromotionCheckStatus
  promotable: boolean
  checks: PromotionCheck[]
  registryHash: string
  evaluatedAt: IsoTimestamp
}

/** Roll a set of release-gate statuses ('pass'|'fail'|'missing') into one PromotionCheckStatus. */
function rollupReleaseGate(statuses: Array<'pass' | 'fail' | 'missing'>): { status: PromotionCheckStatus; reason: string } {
  if (statuses.length === 0) return { status: 'INSUFFICIENT_EVIDENCE', reason: 'no release-gate checks evaluated' }
  const failed = statuses.filter((s) => s === 'fail').length
  const missing = statuses.filter((s) => s === 'missing').length
  if (failed > 0) return { status: 'FAIL', reason: `${failed} release check(s) failed` }
  if (missing > 0) return { status: 'INSUFFICIENT_EVIDENCE', reason: `${missing} release check(s) have no evidence` }
  return { status: 'PASS', reason: `${statuses.length}/${statuses.length} release checks pass` }
}

/**
 * Evaluate the full promotion gate for a candidate version, LIVE. Pure of Date
 * except the `now` parameter (injected so it is deterministically testable and
 * so the persisted `evaluatedAt` is the caller's real clock).
 */
export async function evaluatePromotionGate(
  copilotId: string,
  candidateVersionId: string,
  policy: PromotionPolicy = DEFAULT_PROMOTION_POLICY,
  now: () => Date = () => new Date(),
): Promise<PromotionGateResult | null> {
  const at = now().toISOString()

  // Version + copilot must exist. Read the runtime from the copilot (the engine
  // that would serve this version) — a version cannot outlive its copilot's runtime.
  const copilotRows = await pgrest<Record<string, unknown>[]>(
    'GET',
    `copilots?${eq('id', copilotId)}&select=id,runtime`,
  )
  if (copilotRows.length === 0) return null
  const runtime = (copilotRows[0].runtime as string) ?? 'unknown'

  const versionRows = await pgrest<Record<string, unknown>[]>(
    'GET',
    `copilot_versions?${eq('id', candidateVersionId)}&${eq('copilot_id', copilotId)}&select=id,stage`,
  )
  if (versionRows.length === 0) return null

  const checks: PromotionCheck[] = []

  // 1) The 9-check controlled release gate, re-read live and rolled up.
  const release = await evaluateReleaseGate(copilotId, candidateVersionId)
  const rg = release
    ? rollupReleaseGate(release.checks.map((c) => c.status))
    : { status: 'INSUFFICIENT_EVIDENCE' as PromotionCheckStatus, reason: 'release gate could not be evaluated' }
  checks.push({
    id: 'release-gate',
    label: 'Controlled release gate (tests, benchmark, unsafe, draft…)',
    status: rg.status,
    reason: rg.reason,
    evidenceRef: release?.evidence.testRun?.id ?? null,
    sourceOfTruth: 'release-gate.ts (test_runs, benchmark_runs, improvement_proposals)',
    evaluatedAt: at,
  })

  // 2) The runtime must have a real engine (registry is the authority).
  const runtimeOk = isRuntimeExecutable(runtime)
  checks.push({
    id: 'runtime-executable',
    label: 'Runtime has a real engine',
    status: runtimeOk ? 'PASS' : 'FAIL',
    reason: runtimeOk ? `${runtime} is executable` : `${runtime} has no real engine`,
    evidenceRef: null,
    sourceOfTruth: 'registry/runtimes.ts',
    evaluatedAt: at,
  })

  // 3) Every declared tool must resolve to a CERTIFIED registry tool. A tool
  //    row whose name is unknown to the registry, or known but not certified,
  //    is a phantom/uncertified capability → the version must not go active.
  const toolRows = await pgrest<Record<string, unknown>[]>('GET', `tools?${eq('copilot_id', copilotId)}&select=name`)
  const declared = toolRows.map((t) => t.name as string)
  const phantom = declared.filter((name) => {
    const t = getTool(name)
    return !t || t.certification !== 'certified'
  })
  checks.push({
    id: 'tools-resolved-certified',
    label: 'All declared tools resolve to certified tools',
    status: phantom.length === 0 ? 'PASS' : 'FAIL',
    reason: phantom.length === 0 ? `${declared.length} tool(s), all certified` : `uncertified/phantom: ${phantom.join(', ')}`,
    evidenceRef: null,
    sourceOfTruth: 'registry/tools.ts vs tools table',
    evaluatedAt: at,
  })

  // 4) Shadow proof (only blocking when the policy requires it). Reads the most
  //    recent shadow_experiments row for this candidate.
  const shadowRows = await pgrest<Record<string, unknown>[]>(
    'GET',
    `shadow_experiments?${eq('copilot_id', copilotId)}&${eq('candidate_version_id', candidateVersionId)}&select=id,status,candidate_verdict,would_mutate_count&order=started_at.desc&limit=1`,
  )
  const shadow = shadowRows[0] ?? null
  checks.push({
    id: 'shadow-proof',
    label: 'Shadow experiment proved the candidate',
    ...shadowCheck(shadow, policy.requireShadow),
    evidenceRef: shadow ? (shadow.id as string) : null,
    sourceOfTruth: 'shadow_experiments',
    evaluatedAt: at,
  })

  // 5) Replay comparison (only blocking when required). Reads the latest verdict.
  const replayRows = await pgrest<Record<string, unknown>[]>(
    'GET',
    `replay_comparisons?${eq('copilot_id', copilotId)}&select=id,verdict,status&order=created_at.desc&limit=1`,
  )
  const replay = replayRows[0] ?? null
  checks.push({
    id: 'replay-comparison',
    label: 'Replay comparison vs production',
    ...replayCheck(replay, policy.requireReplay),
    evidenceRef: replay ? (replay.id as string) : null,
    sourceOfTruth: 'replay_comparisons',
    evaluatedAt: at,
  })

  const overall = rollupOverall(checks)
  return {
    copilotId,
    candidateVersionId,
    runtime,
    overall,
    promotable: overall === 'PASS',
    checks,
    registryHash: REGISTRY_HASH,
    evaluatedAt: at,
  }
}

function shadowCheck(
  shadow: Record<string, unknown> | null,
  required: boolean,
): { status: PromotionCheckStatus; reason: string } {
  if (!shadow) {
    return required
      ? { status: 'INSUFFICIENT_EVIDENCE', reason: 'required shadow experiment missing' }
      : { status: 'NOT_CONFIGURED', reason: 'no shadow experiment (not required)' }
  }
  const verdict = shadow.candidate_verdict as string | null
  const status = shadow.status as string
  if (status !== 'completed') return { status: 'INSUFFICIENT_EVIDENCE', reason: `shadow ${status}, not completed` }
  if (verdict === 'PASS') return { status: 'PASS', reason: 'shadow PASS, zero would-mutate breaches' }
  if (verdict === 'INSUFFICIENT_EVIDENCE') return { status: 'INSUFFICIENT_EVIDENCE', reason: 'shadow inconclusive' }
  return { status: 'FAIL', reason: `shadow verdict ${verdict}` }
}

function replayCheck(
  replay: Record<string, unknown> | null,
  required: boolean,
): { status: PromotionCheckStatus; reason: string } {
  if (!replay) {
    return required
      ? { status: 'INSUFFICIENT_EVIDENCE', reason: 'required replay comparison missing' }
      : { status: 'NOT_CONFIGURED', reason: 'no replay comparison (not required)' }
  }
  const verdict = replay.verdict as string | null
  // INCONCLUSIVE can never satisfy a mandatory replay.
  if (verdict === 'BETTER' || verdict === 'EQUIVALENT') return { status: 'PASS', reason: `replay ${verdict}` }
  if (verdict === 'INCONCLUSIVE' || verdict === null) return { status: 'INSUFFICIENT_EVIDENCE', reason: 'replay inconclusive' }
  return { status: 'FAIL', reason: `replay ${verdict}` }
}

/**
 * The overall status. Rules:
 *  - any FAIL              → FAIL (a hard failure blocks).
 *  - any INSUFFICIENT      → INSUFFICIENT_EVIDENCE (a required signal is missing).
 *  - all PASS/NOT_CONFIGURED with ≥1 PASS → PASS (NOT_CONFIGURED = optional, not required).
 * NOT_CONFIGURED alone never blocks (it means an optional check wasn't required).
 */
function rollupOverall(checks: PromotionCheck[]): PromotionCheckStatus {
  if (checks.some((c) => c.status === 'FAIL')) return 'FAIL'
  if (checks.some((c) => c.status === 'INSUFFICIENT_EVIDENCE')) return 'INSUFFICIENT_EVIDENCE'
  // Every remaining check is PASS or NOT_CONFIGURED; require at least one real PASS.
  if (checks.every((c) => c.status === 'NOT_CONFIGURED')) return 'INSUFFICIENT_EVIDENCE'
  return 'PASS'
}

/** Stable FNV-1a of the evidence ids, so a re-eval on the same evidence is stable. */
function evidenceHash(checks: PromotionCheck[]): string {
  const src = checks.map((c) => `${c.id}:${c.status}:${c.evidenceRef ?? ''}`).join('|')
  let h = 0x811c9dc5
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * Persist a gate evaluation into `promotion_gates`. This is what the hardened
 * RPC re-reads: only an `overall_status='ready'` + `gate_result='PASS'` row,
 * fresh within the RPC's TTL, lets a promotion reach ACTIVE. A blocked
 * evaluation is persisted too (for the audit trail + UI), but with a status the
 * RPC will refuse. Returns the persisted row id.
 */
export async function persistGateEvaluation(result: PromotionGateResult): Promise<string> {
  const id = `gate-${randomUUID()}`
  const overallStatus = result.overall === 'PASS' ? 'ready' : 'blocked'
  await pgrest('POST', 'promotion_gates', {
    id,
    copilot_id: result.copilotId,
    candidate_version_id: result.candidateVersionId,
    target_stage: 'production',
    checks: result.checks,
    overall_status: overallStatus,
    gate_result: result.overall,
    registry_hash: result.registryHash,
    evidence_hash: evidenceHash(result.checks),
    last_evaluated_at: result.evaluatedAt,
  })
  return id
}

/**
 * Evaluate AND persist in one call — the shape the promotion route uses right
 * before invoking the RPC, so the RPC always finds a fresh matching row.
 */
export async function evaluateAndPersistPromotionGate(
  copilotId: string,
  candidateVersionId: string,
  policy: PromotionPolicy = DEFAULT_PROMOTION_POLICY,
  now: () => Date = () => new Date(),
): Promise<{ result: PromotionGateResult; gateEvaluationId: string } | null> {
  const result = await evaluatePromotionGate(copilotId, candidateVersionId, policy, now)
  if (!result) return null
  const gateEvaluationId = await persistGateEvaluation(result)
  return { result, gateEvaluationId }
}
