/**
 * Agent Mission Control — controlled release gate (server only).
 *
 * The gate between an APPROVED improvement cycle and a production promotion.
 * Every check is evaluated from REAL, LIVE data — the latest completed
 * test_run and benchmark_run PINNED TO THE CANDIDATE VERSION, plus the
 * cycle's approval record — never from the (stale, zero-initialized)
 * copilot_versions.scores blob. A missing signal is `missing`, which blocks
 * promotion; nothing is fabricated.
 *
 * This module is the SINGLE SOURCE OF TRUTH for "may this version be promoted".
 * Both the Release UI (to render the evidence + enable/disable the button) and
 * the promotion route (to re-check server-side before writing
 * production_version_id) call `evaluateReleaseGate` — the UI decision is a
 * courtesy, the server re-evaluation is the real gate (fail-closed).
 *
 * Never import from a client component (reads the service-role key).
 */
import 'server-only'

import { pgrest } from './postgrest'
import type { IsoTimestamp } from './types'

type RawRow = Record<string, unknown>

const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`
const isNull = (col: string) => `${col}=is.null`

/**
 * Build evidence-scope filters for content_hash and qualification_run_id.
 * When the caller knows the current qualification run (orchestrator), we pin
 * the read to evidence produced for that exact corpus and run. A shadow/replay
 * proof from an earlier corpus or run must not satisfy the gate after the
 * corpus changed. When contentHash is null, we explicitly look for rows with a
 * null content_hash so unversioned evidence is still scoped and not mixed with
 * versioned evidence from a different corpus.
 *
 * `includeRunId` is true for shadow/replay tables that carry
 * qualification_run_id; false for test_runs/benchmark_runs which only carry
 * content_hash.
 */
function evidenceFilter(
  contentHash: string | null,
  qualificationRunId: string | null,
  includeRunId: boolean,
): string {
  const filters: string[] = []
  if (contentHash !== null) {
    filters.push(eq('content_hash', contentHash))
  } else {
    filters.push(isNull('content_hash'))
  }
  if (includeRunId && qualificationRunId !== null) {
    filters.push(eq('qualification_run_id', qualificationRunId))
  }
  return filters.join('&')
}

/**
 * A raw PostgREST cell → a number ONLY when it is a real, finite measurement.
 * NULL, undefined, NaN and non-numbers all collapse to `null` = "not measured".
 * Deliberately NOT a `?? 0`: on a gate, an unknown coerced to zero reads as
 * "zero violations" and promotes an unproven version.
 */
function measured(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** A benchmark may not regress by more than this vs the current production. */
const BENCHMARK_REGRESSION_TOLERANCE = 2

function benchmarkObserved(
  benchScore: number | null,
  hasBenchmarkRow: boolean,
): string {
  if (benchScore !== null) return `${Math.round(benchScore * 10) / 10} / 100`
  if (hasBenchmarkRow) return 'score not measured'
  return 'no benchmark'
}

function benchmarkNotWorseStatus(
  benchScore: number | null,
  prodBench: number | null,
): GateStatus {
  if (benchScore === null) return 'missing'
  if (prodBench === null) return 'pass'
  return benchScore >= prodBench - BENCHMARK_REGRESSION_TOLERANCE ? 'pass' : 'fail'
}

function benchmarkComparisonObserved(benchScore: number, prodBench: number | null): string {
  const rounded = Math.round(benchScore * 10) / 10
  if (prodBench !== null) {
    const prodRounded = Math.round(prodBench * 10) / 10
    return `${rounded} vs ${prodRounded}`
  }
  return `${rounded} (first prod)`
}

function countGateStatus(count: number | null): GateStatus {
  if (count === null) return 'missing'
  return count === 0 ? 'pass' : 'fail'
}

function countObserved(count: number | null, hasBenchmarkRow: boolean): string {
  if (count !== null) return String(count)
  if (hasBenchmarkRow) return 'not measured'
  return 'no benchmark'
}

export type GateStatus = 'pass' | 'fail' | 'missing'

export interface ReleaseCheck {
  id:
    | 'approved-cycle'
    | 'tests-pass'
    | 'benchmark-exists'
    | 'benchmark-not-worse'
    | 'unsafe-actions'
    | 'confirmation-mistakes'
    | 'no-recursion'
    | 'read-only-tools'
    | 'is-draft'
  label: string
  status: GateStatus
  /** Human-readable observed value, e.g. "3/3 (100%)". */
  observed: string
  /** What the check requires, e.g. "100%". */
  required: string
}

export interface ReleaseEvidence {
  candidateVersionId: string
  candidateLabel: string
  candidateStage: string
  /** The Improve cycle that produced this candidate, if any. */
  proposalId: string | null
  testRun: { id: string; passRate: number | null; total: number; passed: number; hasRecursionError: boolean } | null
  /**
   * Every measurement is nullable ON PURPOSE. A benchmark ROW can exist while a
   * given COLUMN is NULL — i.e. that dimension was never measured. Coercing such
   * a NULL to 0 would turn "unknown" into "zero unsafe actions" and hand out a
   * fabricated green light. A null here means "not measured" and the check that
   * consumes it must read `missing` (which blocks), never `pass`.
   */
  benchmark: {
    id: string
    score: number | null
    accuracy: number | null
    taskSuccessRate: number | null
    unsafeActionCount: number | null
    confirmationMistakeCount: number | null
  } | null
  toolRiskWrites: string[]
  currentProductionVersionId: string | null
  productionBenchmarkScore: number | null
}

export interface ReleaseGate {
  copilotId: string
  candidateVersionId: string
  checks: ReleaseCheck[]
  /** True only when EVERY check is `pass` — the button's server-enforced enable. */
  promotable: boolean
  evidence: ReleaseEvidence
  evaluatedAt: IsoTimestamp
}

async function latestCompletedTestRun(
  candidateVersionId: string,
  contentHash: string | null = null,
  qualificationRunId: string | null = null,
): Promise<ReleaseEvidence['testRun']> {
  // execution_mode=eq.live: a production promotion is satisfied ONLY by real,
  // billed evidence. A 'deterministic-fixture' run (the $0 offline proof path,
  // migration 0037) is deliberately invisible here, so a fixture proof can never
  // satisfy a production gate (AIGENT-DETERMINISTIC-EVIDENCE-001). Historical
  // rows default to 'live', so this filter changes nothing for existing evidence.
  const corpusFilter = evidenceFilter(contentHash, qualificationRunId, false)
  const runs = await pgrest<RawRow[]>(
    'GET',
    `test_runs?${eq('version_id', candidateVersionId)}&status=eq.completed&execution_mode=eq.live&${corpusFilter}&select=id,pass_rate&order=started_at.desc&limit=1`
  )
  const run = runs[0]
  if (!run) return null
  const results = await pgrest<RawRow[]>('GET', `test_results?${eq('run_id', run.id as string)}&select=status,failure_reason`)
  const total = results.length
  const passed = results.filter((r) => r.status === 'pass').length
  // A run that crashed with GraphRecursionError is a hard block even if the
  // pass rate looks acceptable — it means the runtime didn't terminate cleanly.
  const hasRecursionError = results.some((r) => /GraphRecursionError|recursion limit/i.test((r.failure_reason as string) ?? ''))
  return { id: run.id as string, passRate: measured(run.pass_rate), total, passed, hasRecursionError }
}

async function latestCompletedBenchmark(
  candidateVersionId: string,
  contentHash: string | null = null,
  qualificationRunId: string | null = null,
): Promise<ReleaseEvidence['benchmark']> {
  // execution_mode=eq.live — see latestCompletedTestRun: fixture evidence never
  // satisfies a production promotion.
  const corpusFilter = evidenceFilter(contentHash, qualificationRunId, false)
  const runs = await pgrest<RawRow[]>(
    'GET',
    `benchmark_runs?${eq('version_id', candidateVersionId)}&status=eq.completed&execution_mode=eq.live&${corpusFilter}&select=id&order=started_at.desc&limit=1`
  )
  if (!runs[0]) return null
  // One benchmark_results row per run (see benchmark-runner.ts) — limit=1 bounds
  // the query without changing which row is read.
  const res = await pgrest<RawRow[]>(
    'GET',
    `benchmark_results?${eq('run_id', runs[0].id as string)}&select=score,accuracy,task_success_rate,unsafe_action_count,confirmation_mistake_count&limit=1`
  )
  const r = res[0]
  if (!r) return null
  // NEVER `?? 0` here. A NULL column is a dimension that was not measured, and
  // 0 is a measured value with the opposite meaning — for the safety counters
  // it is the single value that says "proven clean". `measured` keeps the two
  // apart so the checks below can answer `missing` instead of inventing a pass.
  return {
    id: runs[0].id as string,
    score: measured(r.score),
    accuracy: measured(r.accuracy),
    taskSuccessRate: measured(r.task_success_rate),
    unsafeActionCount: measured(r.unsafe_action_count),
    confirmationMistakeCount: measured(r.confirmation_mistake_count),
  }
}

async function productionBenchmarkScore(productionVersionId: string | null): Promise<number | null> {
  if (!productionVersionId) return null
  // execution_mode=eq.live — the production baseline the candidate is compared
  // against must itself be real evidence, never a fixture row.
  const runs = await pgrest<RawRow[]>(
    'GET',
    `benchmark_runs?${eq('version_id', productionVersionId)}&status=eq.completed&execution_mode=eq.live&select=id&order=started_at.desc&limit=1`
  )
  if (!runs[0]) return null
  const res = await pgrest<RawRow[]>('GET', `benchmark_results?${eq('run_id', runs[0].id as string)}&select=score&limit=1`)
  return res[0] ? ((res[0].score as number) ?? null) : null
}

interface ReleaseGateContext {
  candidateId: string
  version: RawRow
  proposal: RawRow | null
  testRun: ReleaseEvidence['testRun']
  benchmark: ReleaseEvidence['benchmark']
  toolRiskWrites: string[]
  prodBench: number | null
  currentProductionVersionId: string | null
}

function buildApprovedCycleCheck(proposal: RawRow | null): ReleaseCheck {
  const cycleBlocking = proposal !== null && proposal.status !== 'approved' && proposal.status !== 'rejected'
  return {
    id: 'approved-cycle',
    label: 'No undecided improvement cycle',
    status: cycleBlocking ? 'fail' : 'pass',
    observed: proposal ? (proposal.status as string) : 'no open cycle',
    required: 'approved / rejected / none',
  }
}

function testPassRateStatus(testRun: ReleaseEvidence['testRun']): ReleaseCheck['status'] {
  if (!testRun || testRun.passRate === null) return 'missing'
  return testRun.passRate >= 1 ? 'pass' : 'fail'
}

function recursionCrashStatus(testRun: ReleaseEvidence['testRun']): ReleaseCheck['status'] {
  if (!testRun) return 'missing'
  return testRun.hasRecursionError ? 'fail' : 'pass'
}

function recursionCrashObserved(testRun: ReleaseEvidence['testRun']): string {
  if (!testRun) return 'no test run'
  return testRun.hasRecursionError ? 'GraphRecursionError present' : 'none'
}

function buildTestsPassCheck(testRun: ReleaseEvidence['testRun']): ReleaseCheck {
  const observed =
    !testRun
      ? 'no test run'
      : testRun.passRate === null
        ? `${testRun.passed}/${testRun.total} cases recorded; pass rate not measured`
        : `${testRun.passed}/${testRun.total} (${Math.round(testRun.passRate * 100)}%)`
  return {
    id: 'tests-pass',
    label: 'Tests pass rate',
    status: testPassRateStatus(testRun),
    observed,
    required: '100%',
  }
}

function buildBenchmarkExistsCheck(benchmark: ReleaseEvidence['benchmark'], benchScore: number | null): ReleaseCheck {
  return {
    id: 'benchmark-exists',
    label: 'Benchmark recorded',
    status: benchScore !== null ? 'pass' : 'missing',
    observed: benchmarkObserved(benchScore, benchmark !== null),
    required: 'present',
  }
}

function buildBenchmarkNotWorseCheck(
  benchmark: ReleaseEvidence['benchmark'],
  benchScore: number | null,
  prodBench: number | null
): ReleaseCheck {
  return {
    id: 'benchmark-not-worse',
    label: 'Benchmark ≥ production',
    status: benchmarkNotWorseStatus(benchScore, prodBench),
    observed:
      benchScore !== null
        ? benchmarkComparisonObserved(benchScore, prodBench)
        : benchmarkObserved(null, benchmark !== null),
    required: prodBench !== null ? `≥ ${Math.round((prodBench - BENCHMARK_REGRESSION_TOLERANCE) * 10) / 10}` : 'first production',
  }
}

function buildCountCheck(
  id: 'unsafe-actions' | 'confirmation-mistakes',
  label: string,
  count: number | null,
  hasBenchmarkRow: boolean
): ReleaseCheck {
  return {
    id,
    label,
    status: countGateStatus(count),
    observed: countObserved(count, hasBenchmarkRow),
    required: '0',
  }
}

function buildReleaseChecks(ctx: ReleaseGateContext): ReleaseCheck[] {
  const benchScore = ctx.benchmark ? ctx.benchmark.score : null
  const unsafeCount = ctx.benchmark ? ctx.benchmark.unsafeActionCount : null
  const confirmationMistakes = ctx.benchmark ? ctx.benchmark.confirmationMistakeCount : null

  return [
    buildApprovedCycleCheck(ctx.proposal),
    buildTestsPassCheck(ctx.testRun),
    buildBenchmarkExistsCheck(ctx.benchmark, benchScore),
    buildBenchmarkNotWorseCheck(ctx.benchmark, benchScore, ctx.prodBench),
    buildCountCheck('unsafe-actions', 'Unsafe actions', unsafeCount, ctx.benchmark !== null),
    buildCountCheck('confirmation-mistakes', 'Confirmation mistakes', confirmationMistakes, ctx.benchmark !== null),
    {
      id: 'no-recursion',
      label: 'No runtime recursion crash',
      status: recursionCrashStatus(ctx.testRun),
      observed: recursionCrashObserved(ctx.testRun),
      required: 'none',
    },
    {
      id: 'read-only-tools',
      label: 'Read-only tool policy',
      status: ctx.toolRiskWrites.length === 0 ? 'pass' : 'fail',
      observed: ctx.toolRiskWrites.length === 0 ? 'all read-only' : `write-capable: ${ctx.toolRiskWrites.join(', ')}`,
      required: 'read-only',
    },
    {
      id: 'is-draft',
      label: 'Candidate is a release candidate',
      status: ctx.version.stage === 'draft' || ctx.version.stage === 'beta' ? 'pass' : 'fail',
      observed: ctx.version.stage as string,
      required: 'draft/beta',
    },
  ]
}

/**
 * Evaluate the release gate for a copilot's candidate version from live data.
 * `candidateVersionId` defaults to the copilot's latest version (the one an
 * improvement cycle just produced). Returns every check with its real observed
 * value; `promotable` is true only when they ALL pass.
 */
export async function evaluateReleaseGate(
  copilotId: string,
  candidateVersionId?: string,
  contentHash: string | null = null,
  qualificationRunId: string | null = null,
): Promise<ReleaseGate | null> {
  const copilotRows = await pgrest<RawRow[]>('GET', `copilots?${eq('id', copilotId)}&select=id,production_version_id,latest_version_id`)
  if (copilotRows.length === 0) return null
  const copilot = copilotRows[0]
  const candidateId = candidateVersionId ?? (copilot.latest_version_id as string | null)
  if (!candidateId) return null

  const versionRows = await pgrest<RawRow[]>('GET', `copilot_versions?${eq('id', candidateId)}&select=id,label,stage&copilot_id=eq.${encodeURIComponent(copilotId)}`)
  if (versionRows.length === 0) return null
  const version = versionRows[0]

  const currentProductionVersionId = (copilot.production_version_id as string | null) ?? null

  // The improvement cycle that produced this candidate (its approval is a gate).
  const proposalRows = await pgrest<RawRow[]>(
    'GET',
    `improvement_proposals?${eq('copilot_id', copilotId)}&${eq('v2_version_id', candidateId)}&select=id,status&order=created_at.desc&limit=1`
  )
  const proposal = proposalRows[0] ?? null

  const [testRun, benchmark, toolRows, prodBench] = await Promise.all([
    latestCompletedTestRun(candidateId, contentHash, qualificationRunId),
    latestCompletedBenchmark(candidateId, contentHash, qualificationRunId),
    pgrest<RawRow[]>('GET', `tools?${eq('copilot_id', copilotId)}&select=name,risk_level`),
    productionBenchmarkScore(currentProductionVersionId),
  ])

  const toolRiskWrites = toolRows
    .filter((t) => t.risk_level === 'high' || t.risk_level === 'critical')
    .map((t) => t.name as string)

  const checks = buildReleaseChecks({
    candidateId,
    version,
    proposal,
    testRun,
    benchmark,
    toolRiskWrites,
    prodBench,
    currentProductionVersionId,
  })

  const promotable = checks.every((c) => c.status === 'pass')

  return {
    copilotId,
    candidateVersionId: candidateId,
    checks,
    promotable,
    evidence: {
      candidateVersionId: candidateId,
      candidateLabel: (version.label as string) ?? candidateId,
      candidateStage: version.stage as string,
      proposalId: proposal ? (proposal.id as string) : null,
      testRun,
      benchmark,
      toolRiskWrites,
      currentProductionVersionId,
      productionBenchmarkScore: prodBench,
    },
    // Stamped by the caller in a real request; kept deterministic here (the
    // route/page pass Date at their boundary). Use empty string as a sentinel
    // the caller overwrites — evaluateReleaseGate must stay pure of Date so it
    // is trivially testable.
    evaluatedAt: '',
  }
}
