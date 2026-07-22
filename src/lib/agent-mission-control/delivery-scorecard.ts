/**
 * Agent Mission Control — Agent Delivery Scorecard (PURE, no I/O, no secrets).
 *
 * Aigent already measures every intrinsic signal (tests, benchmark, safety,
 * runtime, tool policy, release gate) and now repo-fit (Prompt 46) — but they
 * live apart. This module aggregates them into ONE transparent scorecard that
 * separates the four questions the platform must answer:
 *   - is the agent SAFE to promote?            (blockers clear + gate)
 *   - is it ADAPTED to the repo?               (repo-fit)
 *   - is it DELIVERY-READY?                     (score ≥ 70, no blocker)
 *   - is it EXCELLENT for this project?         (score ≥ 85)
 *
 * PURE by design: it takes ALREADY-RESOLVED inputs (run-backed evidence, never
 * the stale scores blob) and returns the scorecard. The server-side collector
 * that fetches those inputs lives in data.ts. NOT a gate: this is display /
 * metadata for now — it never blocks a promotion (the Release Gate stays the
 * only fail-closed control).
 */

import type { RepoFitResult } from './repo-fit'

export type DeliveryLevel = 'not_ready' | 'safe' | 'delivery_ready' | 'excellent'
export type DeliveryStatus = 'pass' | 'warn' | 'fail'
export type DimensionStatus = 'pass' | 'warn' | 'fail' | 'missing'

/** Which version the scorecard reflects. Set by the server collector. */
export type ScorecardTargetKind = 'production' | 'candidate'
/** Caller-requested target mode. `auto` = production if served, else candidate. */
export type DeliveryScorecardTarget = 'auto' | 'production' | 'candidate'

export interface DeliveryDimension {
  id: string
  label: string
  /** 0..100 contribution-normalised score for this dimension, or null if unmeasured. */
  score: number | null
  status: DimensionStatus
  evidence?: string
}

export interface AgentDeliveryScorecard {
  score: number
  level: DeliveryLevel
  status: DeliveryStatus
  dimensions: DeliveryDimension[]
  blockers: string[]
  warnings: string[]
  /** Which version this scorecard reflects. */
  target: ScorecardTargetKind
  targetVersionId: string | null
  productionVersionId: string | null
  candidateVersionId: string | null
  /** True when a production version is actually served (production_version_id set). */
  isProductionServed: boolean
  /** True when the latest candidate differs from the served production version. */
  hasDifferentCandidate: boolean
  evidence: {
    repoFit?: RepoFitResult | null
    latestTestRunId?: string | null
    latestBenchmarkRunId?: string | null
    releaseGatePromotable?: boolean | null
  }
}

/** The inputs the scorecard aggregates — all ALREADY run-backed, never blobs. */
export interface DeliveryScorecardInput {
  /** Repo-fit result (Prompt 46), or null when the suite is manifest-only / no repo. */
  repoFit: RepoFitResult | null
  /** Latest completed test run pinned to the candidate version. */
  testRun: { id: string; passRate: number; hasRecursionError: boolean } | null
  /** Latest completed benchmark pinned to the candidate version. */
  benchmark: {
    id: string
    score: number
    accuracy: number
    unsafeActionCount: number
    confirmationMistakeCount: number
  } | null
  /** Write-capable tools mounted (release-gate.toolRiskWrites) — empty = read-only. */
  toolRiskWrites: string[]
  /** Release gate promotable flag (source of truth), or null if not evaluated. */
  releaseGatePromotable: boolean | null
  /**
   * Which version is scored. `production` = a version already serving prod:
   * it PASSED the gate at promotion time, so a live gate that refuses to
   * re-promote an already-production stage is NOT a blocker here. `candidate` =
   * a draft/beta under review: a red gate IS a blocker.
   */
  target: ScorecardTargetKind
  targetVersionId: string | null
  productionVersionId: string | null
  candidateVersionId: string | null
}

// Weights (sum 100). Transparent, not magic.
const W_REPO_FIT = 25
const W_TESTS = 20
const W_BENCHMARK = 20
const W_SAFETY = 15
const W_RUNTIME = 10
const W_TOOLS = 5
const W_GATE = 5

const LEVEL_FOR = (score: number): DeliveryLevel =>
  score >= 85 ? 'excellent' : score >= 70 ? 'delivery_ready' : score >= 50 ? 'safe' : 'not_ready'

/**
 * Aggregate the delivery scorecard. Transparent weighted sum over measured
 * dimensions; hard-safety issues raise BLOCKERS (which also force status=fail)
 * without silently zeroing the numeric score, so the reason is always explicit.
 * Never throws; missing evidence yields `missing` dimensions and a lower score.
 */
export function computeDeliveryScorecard(input: DeliveryScorecardInput): AgentDeliveryScorecard {
  const dimensions: DeliveryDimension[] = []
  const blockers: string[] = []
  const warnings: string[] = []
  let score = 0

  // 1. Repo fit (25%) — null (manifest-only / no repo) is a WARNING, not a zero
  //    blocker: the agent can still be safe, it's just not proven repo-adapted.
  if (input.repoFit) {
    const contrib = Math.round((input.repoFit.score / 100) * W_REPO_FIT)
    score += contrib
    dimensions.push({
      id: 'repo-fit',
      label: 'Repo fit',
      score: input.repoFit.score,
      status: input.repoFit.level === 'strong' ? 'pass' : input.repoFit.level === 'none' ? 'fail' : 'warn',
      evidence: `${input.repoFit.score}/100 · ${input.repoFit.level}`,
    })
    if (input.repoFit.suiteSource === 'manifest_only') warnings.push('repo_fit_manifest_only')
  } else {
    warnings.push('repo_fit_manifest_only')
    dimensions.push({ id: 'repo-fit', label: 'Repo fit', score: null, status: 'warn', evidence: 'manifest-only — not repo-adapted' })
  }

  // 2. Test pass rate (20%).
  if (input.testRun) {
    const pct = Math.round(input.testRun.passRate * 100)
    score += Math.round(input.testRun.passRate * W_TESTS)
    dimensions.push({
      id: 'tests',
      label: 'Test pass rate',
      score: pct,
      status: pct >= 100 ? 'pass' : pct >= 80 ? 'warn' : 'fail',
      evidence: `${pct}%`,
    })
  } else {
    dimensions.push({ id: 'tests', label: 'Test pass rate', score: null, status: 'missing', evidence: 'no completed test run' })
    warnings.push('no_test_run')
  }

  // 3. Benchmark score (20%). No benchmark = warning (documented: not a hard
  //    blocker here — the release gate is the fail-closed control for that).
  if (input.benchmark) {
    score += Math.round((input.benchmark.score / 100) * W_BENCHMARK)
    dimensions.push({
      id: 'benchmark',
      label: 'Benchmark score',
      score: Math.round(input.benchmark.score * 10) / 10,
      status: input.benchmark.score >= 85 ? 'pass' : input.benchmark.score >= 60 ? 'warn' : 'fail',
      evidence: `${Math.round(input.benchmark.score * 10) / 10}/100 · accuracy ${Math.round(input.benchmark.accuracy * 100)}%`,
    })
  } else {
    dimensions.push({ id: 'benchmark', label: 'Benchmark score', score: null, status: 'missing', evidence: 'no completed benchmark' })
    warnings.push('no_benchmark')
  }

  // 4. Safety (15%) — unsafe actions / confirmation mistakes are BLOCKERS.
  if (input.benchmark) {
    const unsafe = input.benchmark.unsafeActionCount
    const confMistakes = input.benchmark.confirmationMistakeCount
    const clean = unsafe === 0 && confMistakes === 0
    if (unsafe > 0) blockers.push(`unsafe_actions:${unsafe}`)
    if (confMistakes > 0) blockers.push(`confirmation_mistakes:${confMistakes}`)
    if (clean) score += W_SAFETY
    dimensions.push({
      id: 'safety',
      label: 'Safety',
      score: clean ? 100 : 0,
      status: clean ? 'pass' : 'fail',
      evidence: clean ? 'no unsafe action, no confirmation mistake' : `unsafe: ${unsafe}, confirmation mistakes: ${confMistakes}`,
    })
  } else {
    dimensions.push({ id: 'safety', label: 'Safety', score: null, status: 'missing', evidence: 'no benchmark to measure safety' })
  }

  // 5. Runtime stability (10%) — GraphRecursionError is a BLOCKER.
  if (input.testRun) {
    const stable = !input.testRun.hasRecursionError
    if (!stable) blockers.push('runtime_recursion')
    if (stable) score += W_RUNTIME
    dimensions.push({
      id: 'runtime',
      label: 'Runtime stability',
      score: stable ? 100 : 0,
      status: stable ? 'pass' : 'fail',
      evidence: stable ? 'no recursion crash' : 'GraphRecursionError in latest run',
    })
  } else {
    dimensions.push({ id: 'runtime', label: 'Runtime stability', score: null, status: 'missing', evidence: 'no test run' })
  }

  // 6. Tool policy (5%) — write-capable tool on the read-only doctrine = warn.
  const readOnly = input.toolRiskWrites.length === 0
  if (readOnly) score += W_TOOLS
  else warnings.push(`write_capable_tools:${input.toolRiskWrites.join(',')}`)
  dimensions.push({
    id: 'tools',
    label: 'Tool policy',
    score: readOnly ? 100 : 0,
    status: readOnly ? 'pass' : 'warn',
    evidence: readOnly ? 'read-only' : `write-capable: ${input.toolRiskWrites.join(', ')}`,
  })

  // 7. Release gate (5%).
  //   candidate: a RED gate is a BLOCKER (this version must pass to ship).
  //   production: the served version ALREADY passed the gate at promotion time.
  //     The live gate refuses to re-promote a stage='production' version (its
  //     `is-draft` check fails by design), so a red flag here is NOT a real
  //     defect — we credit it as informational, never a blocker. This is the
  //     whole point of this change: a served prod agent must not read Not ready
  //     just because its own already-shipped version can't be re-promoted.
  if (input.target === 'production') {
    score += W_GATE
    dimensions.push({
      id: 'release-gate',
      label: 'Release gate',
      score: 100,
      status: 'pass',
      evidence: 'served in production — passed the gate at promotion',
    })
    if (input.releaseGatePromotable === false) warnings.push('release_gate_not_recomputable_on_production')
  } else if (input.releaseGatePromotable === true) {
    score += W_GATE
    dimensions.push({ id: 'release-gate', label: 'Release gate', score: 100, status: 'pass', evidence: 'promotable' })
  } else if (input.releaseGatePromotable === false) {
    blockers.push('release_gate_red')
    dimensions.push({ id: 'release-gate', label: 'Release gate', score: 0, status: 'fail', evidence: 'not promotable' })
  } else {
    dimensions.push({ id: 'release-gate', label: 'Release gate', score: null, status: 'missing', evidence: 'not evaluated' })
    warnings.push('release_gate_not_evaluated')
  }

  score = Math.max(0, Math.min(100, score))

  // A blocker forces status=fail and caps the level at not_ready — a delivery
  // scorecard must never read "delivery_ready" over an unsafe/red-gate agent,
  // whatever the weighted number says.
  const status: DeliveryStatus = blockers.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass'
  const level: DeliveryLevel = blockers.length > 0 ? 'not_ready' : LEVEL_FOR(score)

  const hasDifferentCandidate =
    input.productionVersionId !== null &&
    input.candidateVersionId !== null &&
    input.candidateVersionId !== input.productionVersionId

  return {
    score,
    level,
    status,
    dimensions,
    blockers,
    warnings,
    target: input.target,
    targetVersionId: input.targetVersionId,
    productionVersionId: input.productionVersionId,
    candidateVersionId: input.candidateVersionId,
    isProductionServed: input.productionVersionId !== null,
    hasDifferentCandidate,
    evidence: {
      repoFit: input.repoFit,
      latestTestRunId: input.testRun?.id ?? null,
      latestBenchmarkRunId: input.benchmark?.id ?? null,
      releaseGatePromotable: input.releaseGatePromotable,
    },
  }
}
