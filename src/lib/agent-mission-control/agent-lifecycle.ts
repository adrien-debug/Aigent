/**
 * Agent lifecycle — what an operator may actually DO to this agent, and why not
 * (AIGENT-OPERATOR-RESTORE-028, server only).
 *
 * The Evolution and Release surfaces render eight controls. Before this module
 * each surface decided on its own whether a control should be enabled, and the
 * answers drifted: a "Run tests" button was offered on an `openai-assistants`
 * copilot, and clicking it silently executed the copilot on the LangGraph
 * Agent Server — a runtime that is not its own. A control that lies about what
 * it will do is worse than a control that is missing.
 *
 * AIGENT-RUNNER-RUNTIME-029 narrowed that gap for `run-tests`, and
 * AIGENT-BENCH-RUNTIME-030 closed the same one for `run-benchmark`. Both
 * engines now branch on the copilot's OWN runtime and agree on the three
 * answers: `langgraph` streams the graph, `openai-assistants` drives
 * `executeCopilotRun` with the manifest's real tools, and anything else raises
 * `UnsupportedRuntimeError` up front instead of falling back onto whichever
 * engine happens to be wired.
 *
 * That collapsed the last `degraded` runtime verdict in this module, and it
 * collapsed it in BOTH directions. `run-benchmark` on `openai-assistants` is
 * now plainly `available` — the tool-less `runTaskViaCompletion` it used to
 * fall to is deleted, so the safety assertions have real tool calls to observe.
 * And on an unserved runtime it is no longer `degraded` either: the runner
 * throws before the `benchmark_runs` insert, so the action does not run in a
 * reduced form, it does not run at all. A capability that still described the
 * old engine would refuse an action the engine now serves — a stale detail is
 * as harmful as a missing one. Capability text tracks the engine, never the
 * other way round.
 *
 * So: ONE derivation, and a capability is never a bare boolean. Unavailability
 * always carries its reason (operator-facing, one line) and its detail
 * (technical, verifiable against the code that enforces it). A view that
 * disables a control MUST render the reason next to it — a dead button with no
 * explanation is the failure mode this module exists to prevent.
 *
 * Nothing is recomputed here. `evaluateReleaseGate` owns promotability,
 * `getAgentDetail` owns versions/manifest/blockers, `getLatestProposalForCopilot`
 * owns the improvement cycle. This module only reads them and states what
 * follows. A read that fails makes the capability `unavailable` with the error —
 * never a silent `0`, never a hopeful `available`.
 */
import 'server-only'

import { getAgentDetail } from './agent-detail'
import { getLatestProposalForCopilot, type ImprovementProposal } from './improvement-loop'
import { IMPROVEMENT_MIN_BENCHMARK_SCORE } from './improvement-criteria'
import { pgrest, pgrestDetail } from './postgrest'
import { evaluateReleaseGate, type ReleaseGate } from './release-gate'
import type { CopilotVersion } from './types'

type RawRow = Record<string, unknown>

const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`

export type LifecycleActionId =
  | 'generate-suite'
  | 'run-tests'
  | 'run-benchmark'
  | 'auto-improve'
  | 'create-v2'
  | 'decide'
  | 'promote'
  | 'rollback'

/**
 * A capability is never a bare boolean: the indisponibility carries its reason.
 *
 * - `available`   the action does what its label says.
 * - `degraded`    the action RUNS but does not prove what it claims. Offering it
 *                 is legitimate; offering it silently is not — the view states
 *                 the shortfall BEFORE the click.
 * - `unavailable` the action must not be offered at all.
 */
export type Capability =
  | { state: 'available' }
  | { state: 'degraded'; reason: string; detail: string }
  | { state: 'unavailable'; reason: string; detail: string }

export type AgentLifecycle = {
  copilotId: string
  runtime: string | null
  hasManifest: boolean
  versions: CopilotVersion[]
  productionVersion: CopilotVersion | undefined
  candidateVersion: CopilotVersion | undefined
  /** Test suites persisted for this copilot. `0` is measured; a failed read is not — see `capabilities['run-tests']`. */
  suiteCount: number
  /**
   * Latest completed benchmark for this copilot, whatever version it ran on.
   * `null` = no completed benchmark exists (or the read failed). `score: null`
   * inside a non-null object = the run exists but recorded no score — the two
   * are different claims and must not collapse into one.
   */
  latestBenchmark: { score: number | null; recordedAt: string | null } | null
  latestProposal: ImprovementProposal | null
  gate: ReleaseGate | null
  capabilities: Record<LifecycleActionId, Capability>
}

/**
 * The runtime that resolves an assistant on the LangGraph Agent Server — the
 * graph path of both `test-runner.ts` and `benchmark-runner.ts`. Nothing else
 * has a graph to route to.
 */
const GRAPH_RUNTIME = 'langgraph'

/**
 * The non-graph runtime both engines serve: the direct model-router loop of
 * `executeCopilotRun`, with the manifest's real tools, confirmation gate and
 * cost ceiling. `run-tests` and `run-benchmark` now agree about this value —
 * they used to disagree only because the benchmark runner had no such branch.
 */
const DIRECT_RUNTIME = 'openai-assistants'

const unavailable = (reason: string, detail: string): Capability => ({ state: 'unavailable', reason, detail })
const degraded = (reason: string, detail: string): Capability => ({ state: 'degraded', reason, detail })
const AVAILABLE: Capability = { state: 'available' }

/**
 * Count the copilot's test suites. Returns `null` — not `0` — when the read
 * fails, so "no suite" and "we could not look" stay distinguishable all the way
 * to the screen.
 */
async function readSuiteCount(copilotId: string): Promise<{ count: number } | { error: string }> {
  try {
    const rows = await pgrest<RawRow[]>('GET', `test_suites?${eq('copilot_id', copilotId)}&select=id&limit=200`)
    return { count: rows.length }
  } catch (err) {
    return { error: pgrestDetail(err) }
  }
}

/**
 * Latest COMPLETED benchmark for the copilot, across versions.
 *
 * `release-gate.ts` reads the benchmark pinned to the candidate version — the
 * right question for a promotion. This one answers a different question: has
 * this agent ever been benchmarked at all, which is what the auto-improve
 * signal and the Evolution surface need. Two questions, two reads, neither
 * standing in for the other.
 */
async function readLatestBenchmark(
  copilotId: string
): Promise<{ benchmark: AgentLifecycle['latestBenchmark'] } | { error: string }> {
  try {
    const suites = await pgrest<RawRow[]>('GET', `benchmark_suites?${eq('copilot_id', copilotId)}&select=id&limit=100`)
    if (suites.length === 0) return { benchmark: null }
    const ids = suites.map((s) => encodeURIComponent(s.id as string)).join(',')
    const runs = await pgrest<RawRow[]>(
      'GET',
      `benchmark_runs?suite_id=in.(${ids})&status=eq.completed&select=id,finished_at,started_at&order=started_at.desc&limit=1`
    )
    const run = runs[0]
    if (!run) return { benchmark: null }
    const results = await pgrest<RawRow[]>(
      'GET',
      `benchmark_results?${eq('run_id', run.id as string)}&select=score&limit=1`
    )
    const raw = results[0]?.score
    return {
      benchmark: {
        // A run row with no result row, or a null score, is "recorded nothing" —
        // never 0, which would read as a measured floor.
        score: typeof raw === 'number' && Number.isFinite(raw) ? raw : null,
        recordedAt: ((run.finished_at as string | null) ?? (run.started_at as string | null)) ?? null,
      },
    }
  } catch (err) {
    return { error: pgrestDetail(err) }
  }
}

/**
 * The runtime question, restated from the engine that actually answers it
 * (`test-runner.ts` → `executeCaseOnRuntime`, AIGENT-RUNNER-RUNTIME-029).
 *
 * Two runtimes have an engine, and each case runs on the copilot's OWN one:
 * `langgraph` streams the Agent Server, `openai-assistants` drives
 * `executeCopilotRun`. Any other value makes `runTestSuite` throw
 * `UnsupportedRuntimeError` BEFORE the case loop — so offering the control
 * there would promise a 409, not a measurement.
 *
 * The direct path carries one condition the graph path does not: it persists an
 * `agent_runs` row per case, and `agent_runs.project_id` is required, so a
 * copilot still on the validation bench (`project_id` null) is refused up front
 * by `runTestSuite`. That refusal is real, so it is stated here too.
 */
function testCapability(
  runtime: string | null,
  projectId: string | null,
  suiteCount: number | null,
  suiteError: string | null
): Capability {
  if (suiteError !== null) {
    return unavailable(
      'Cannot read this agent’s test suites',
      `The test_suites read failed (${suiteError}), so the number of suites is unknown. It is not zero — it is unread.`
    )
  }
  if (runtime !== GRAPH_RUNTIME && runtime !== DIRECT_RUNTIME) {
    return unavailable(
      'No test execution engine for this runtime',
      `runTestSuite() accepts '${GRAPH_RUNTIME}' and '${DIRECT_RUNTIME}' only; on a '${runtime ?? 'unset'}' copilot it throws UnsupportedRuntimeError before the first case, and runCase()’s switch has no branch to fall back to. Running the suite on an engine that is not this agent’s would measure the engine, not the agent.`
    )
  }
  if (runtime === DIRECT_RUNTIME && projectId === null) {
    return unavailable(
      'This agent is on the validation bench, with no project',
      `The direct path persists an agent_runs row per case (executeCopilotRun owns that write) and agent_runs.project_id is NOT NULL, so runTestSuite() refuses a copilot whose project_id is null. Assign the copilot to a project first — that assignment is the act of validation.`
    )
  }
  if (suiteCount === 0) {
    return unavailable(
      'No test suite exists yet',
      'No test_suites row references this copilot. Generate a suite first — the run route has nothing to execute.'
    )
  }
  return AVAILABLE
}

/**
 * The benchmark question, restated from the engine that answers it
 * (`runBenchmarkSuite`, AIGENT-BENCH-RUNTIME-030) — the same three-way routing
 * as `testCapability`, because the two runners now make the same three
 * decisions.
 *
 * `langgraph` runs each task on the Agent Server; `openai-assistants` runs it
 * through `executeCopilotRun` with the manifest's real tools, so
 * `assertToolCallSafety` observes ground-truth tool calls and the safety score
 * is earned on the same evidence as a graph agent's. There is no longer an
 * off-graph shortfall to warn about: the tool-less `runTaskViaCompletion` this
 * capability used to describe no longer exists.
 *
 * Anything else is `unavailable`, not `degraded`: `runBenchmarkSuite` raises
 * `UnsupportedRuntimeError` before the `benchmark_runs` insert, so the action
 * produces no run at all — nothing runs in a reduced form.
 *
 * The direct path carries the same project condition as the test path, for the
 * same reason: `executeCopilotRun` persists an `agent_runs` row per TASK.
 */
function benchmarkCapability(
  runtime: string | null,
  projectId: string | null,
  benchmarkError: string | null
): Capability {
  if (benchmarkError !== null) {
    return unavailable(
      'Cannot read this agent’s benchmark history',
      `The benchmark_suites/benchmark_runs read failed (${benchmarkError}). Launching a benchmark without knowing the current state would produce a comparison against an unknown baseline.`
    )
  }
  if (runtime !== GRAPH_RUNTIME && runtime !== DIRECT_RUNTIME) {
    return unavailable(
      'No benchmark execution engine for this runtime',
      `runBenchmarkSuite() serves '${GRAPH_RUNTIME}' (Agent Server) and '${DIRECT_RUNTIME}' (direct model-router loop) only; on a '${runtime ?? 'unset'}' copilot it throws UnsupportedRuntimeError before the benchmark_runs insert, so no run is even recorded. It no longer falls back to a tool-less completion that graded the model’s prose instead of this agent.`
    )
  }
  if (runtime === DIRECT_RUNTIME && projectId === null) {
    return unavailable(
      'This agent is on the validation bench, with no project',
      `The direct path persists an agent_runs row per task (executeCopilotRun owns that write) and agent_runs.project_id is NOT NULL, so runBenchmarkSuite() refuses a copilot whose project_id is null — before any benchmark_runs row is created. Assign the copilot to a project first.`
    )
  }
  return AVAILABLE
}

/**
 * Suite generation is derived from the copilot's OWN manifest + tools
 * (`agent-suite-generator.ts`), never from a runtime execution — so it is the
 * one lifecycle action the runtime gap does not touch. It refuses only when
 * there is nothing to derive from, or when suites already exist (the route is
 * idempotent and answers `alreadyExists`, which is a no-op, not a failure).
 */
function generateSuiteCapability(
  hasManifest: boolean,
  suiteCount: number | null,
  suiteError: string | null
): Capability {
  if (!hasManifest) {
    return unavailable(
      'No manifest to derive a suite from',
      'ensureAgentSuites() reads the version’s manifest (system prompt + forbidden actions + tools) to synthesize cases. Without a manifest row it returns null and writes nothing.'
    )
  }
  if (suiteError !== null) {
    return unavailable(
      'Cannot read this agent’s test suites',
      `The test_suites read failed (${suiteError}), so whether a suite already exists is unknown. Generating blind risks a duplicate suite at LLM cost.`
    )
  }
  if (suiteCount !== null && suiteCount > 0) {
    return unavailable(
      'A test suite already exists',
      'ensureAgentSuites() is idempotent: it returns early when a test_suites row exists, so the route would answer alreadyExists and write nothing.'
    )
  }
  return AVAILABLE
}

/**
 * Auto-improve needs a SIGNAL, and the signal is not the agent's opinion of
 * itself. `analyzeAndPropose` throws `nothing to improve:` unless a completed
 * test run pinned to the base version has failing cases, or a benchmark scores
 * below the improve target.
 *
 * That signal is RUNTIME-AGNOSTIC by construction: `collectImprovementSignals`
 * reads `test_runs?status=eq.completed&version_id=eq.<base>` plus its
 * `test_results` in (fail,error) — rows, not graphs. It never asks which engine
 * produced them. So the capability follows `run-tests`: wherever a suite can
 * now complete, failing cases can be recorded and the cycle has something to
 * read. Where the suite cannot run at all, the first half of the signal can
 * never exist, and saying so up front is more honest than letting the cycle
 * burn an LLM call to discover it.
 */
function autoImproveCapability(
  testCapabilityState: Capability,
  suiteCount: number | null,
  benchmark: AgentLifecycle['latestBenchmark'],
  proposal: ImprovementProposal | null
): Capability {
  if (proposal !== null && (proposal.status === 'proposed' || proposal.status === 'v2-created')) {
    return unavailable(
      'An improvement cycle is still open',
      `Proposal ${proposal.id} is '${proposal.status}'. Decide it (approve or reject) before starting another cycle — a second proposal over an undecided one also blocks the release gate’s approved-cycle check.`
    )
  }

  const benchmarkBelowTarget =
    benchmark !== null && benchmark.score !== null && benchmark.score < IMPROVEMENT_MIN_BENCHMARK_SCORE
  if (benchmarkBelowTarget) return AVAILABLE

  if (suiteCount === 0) {
    return unavailable(
      'No test suite, no benchmark below target',
      `collectImprovementSignals() has nothing to read: no test_suites row for this copilot, and no benchmark scoring under ${IMPROVEMENT_MIN_BENCHMARK_SCORE}. analyzeAndPropose() would throw "nothing to improve".`
    )
  }
  // A suite exists but can never be EXECUTED (unsupported runtime, bench copilot
  // on the direct path, unreadable suites). Its cases can therefore never reach
  // `test_results` in (fail,error), which is the only failing-case source
  // `collectImprovementSignals` has.
  if (testCapabilityState.state === 'unavailable') {
    return unavailable(
      'No improvement signal this agent can produce',
      `collectImprovementSignals() reads failing cases from completed test_runs; this agent cannot run its suite at all (${testCapabilityState.reason}), so no failing case can ever be recorded, and no benchmark scores under ${IMPROVEMENT_MIN_BENCHMARK_SCORE} either. analyzeAndPropose() would throw "nothing to improve".`
    )
  }
  return AVAILABLE
}

/** `createImprovementV2` requires a proposal in exactly `proposed` (atomic claim on that status). */
function createV2Capability(proposal: ImprovementProposal | null): Capability {
  if (proposal === null) {
    return unavailable(
      'No proposal to turn into a V2',
      'createImprovementV2() reads an improvement_proposals row; none exists for this copilot. Run the analysis first.'
    )
  }
  if (proposal.status !== 'proposed') {
    return unavailable(
      `The latest proposal is ${proposal.status}`,
      `createImprovementV2() claims the row with a conditional PATCH on status=eq.proposed; from '${proposal.status}' that claim matches zero rows and the route answers 409.`
    )
  }
  return AVAILABLE
}

/** `decideProposal` records the human verdict; approval additionally requires the V2 to exist. */
function decideCapability(proposal: ImprovementProposal | null): Capability {
  if (proposal === null) {
    return unavailable(
      'No proposal to decide',
      'decideProposal() reads an improvement_proposals row; none exists for this copilot.'
    )
  }
  if (proposal.status === 'approved' || proposal.status === 'rejected') {
    return unavailable(
      `Already ${proposal.status}`,
      `Proposal ${proposal.id} was decided on ${proposal.decidedAt ?? 'an unrecorded date'} by ${proposal.decidedBy ?? 'an unrecorded operator'}. A decision is final; the route answers 409.`
    )
  }
  if (proposal.status === 'proposed') {
    // Rejection is legal from `proposed`, approval is not — the control is real
    // but half of it will refuse, so the operator is told before the click.
    return degraded(
      'Can only be rejected until a V2 exists',
      'decideProposal() requires status v2-created to approve: approving a proposal whose V2 was never built would mark a candidate that does not exist as shippable. Rejection from `proposed` is accepted.'
    )
  }
  return AVAILABLE
}

/**
 * Promotion is the release gate's verdict, restated — never recomputed.
 * `evaluateReleaseGate` is the single source of truth and the promotion route
 * re-runs it server-side before any write, so a UI that disagreed here would
 * only be promising a 422.
 *
 * Note what this capability does NOT mean: there is no automatic promotion
 * anywhere in this codebase. `available` says a human MAY promote, not that
 * anything will.
 */
function promoteCapability(
  gate: ReleaseGate | null,
  gateError: string | null,
  productionVersionId: string | null | undefined
): Capability {
  if (gateError !== null) {
    return unavailable(
      'Release gate could not be evaluated',
      `evaluateReleaseGate() failed (${gateError}). The promotion route re-evaluates the same gate before writing, so it would refuse too.`
    )
  }
  if (gate === null) {
    return unavailable(
      'No candidate version to promote',
      'evaluateReleaseGate() returned null: this copilot has no latest_version_id, or the version it points at does not exist.'
    )
  }
  if (productionVersionId !== null && productionVersionId !== undefined && gate.candidateVersionId === productionVersionId) {
    return unavailable(
      'Already in production',
      'This version is already serving consumers. Author a newer draft or beta version before promoting again.'
    )
  }
  if (!gate.promotable) {
    const blocking = gate.checks.filter((c) => c.status !== 'pass')
    return unavailable(
      `Release gate is not green (${blocking.length} of ${gate.checks.length} check${blocking.length > 1 ? 's' : ''} blocking)`,
      blocking.map((c) => `${c.label}: observed ${c.observed}, requires ${c.required}`).join(' · ')
    )
  }
  return AVAILABLE
}

/**
 * Rollback restores a version that ALREADY served production, which is why the
 * promotion route exempts it from the gate. It therefore needs a previously
 * shipped version that is not the one serving today: `archived` is the stage
 * the promotion transition stamps on the outgoing production version.
 */
function rollbackCapability(versions: CopilotVersion[], productionVersion: CopilotVersion | undefined): Capability {
  if (productionVersion === undefined) {
    return unavailable(
      'Nothing is in production',
      'copilots.production_version_id is unset, so there is no production pointer to move back.'
    )
  }
  const previouslyShipped = versions.filter((v) => v.id !== productionVersion.id && v.stage === 'archived')
  if (previouslyShipped.length === 0) {
    return unavailable(
      'No earlier production version to return to',
      `No copilot_versions row for this copilot is 'archived' — the stage the promotion transition stamps on an outgoing production version. Rolling back to a draft would ship something that never passed a gate.`
    )
  }
  return AVAILABLE
}

/**
 * Everything the Evolution and Release surfaces need, derived once.
 *
 * Returns `undefined` only when the copilot itself does not exist (mirrors
 * `getAgentDetail`). Every other failure becomes a named `unavailable`
 * capability rather than an exception or a reassuring default.
 */
export async function getAgentLifecycle(copilotId: string): Promise<AgentLifecycle | undefined> {
  const detail = await getAgentDetail(copilotId)
  if (detail === undefined) return undefined

  // Each read is settled independently: one failing backend read must degrade
  // exactly the capabilities that depended on it, not the whole page.
  const [suiteRead, benchmarkRead, proposalResult, gateResult] = await Promise.all([
    readSuiteCount(copilotId),
    readLatestBenchmark(copilotId),
    getLatestProposalForCopilot(copilotId).then(
      (p) => ({ proposal: p }),
      (err: unknown) => ({ error: pgrestDetail(err) })
    ),
    evaluateReleaseGate(copilotId).then(
      (g) => ({ gate: g }),
      (err: unknown) => ({ error: pgrestDetail(err) })
    ),
  ])

  const suiteCount = 'count' in suiteRead ? suiteRead.count : null
  const suiteError = 'error' in suiteRead ? suiteRead.error : null
  const latestBenchmark = 'benchmark' in benchmarkRead ? benchmarkRead.benchmark : null
  const benchmarkError = 'error' in benchmarkRead ? benchmarkRead.error : null
  const latestProposal = 'proposal' in proposalResult ? proposalResult.proposal : null
  const proposalError = 'error' in proposalResult ? proposalResult.error : null
  const gate = 'gate' in gateResult ? gateResult.gate : null
  const gateError = 'error' in gateResult ? gateResult.error : null

  const runtime = detail.copilot.runtime ?? null
  const hasManifest = detail.manifest !== undefined

  const productionVersion = detail.versions.find((v) => v.id === detail.copilot.productionVersionId)
  // The candidate is the version the gate is actually evaluating, so the two
  // can never point at different rows on the same screen.
  const gateCandidate = gate
    ? detail.versions.find((v) => v.id === gate.candidateVersionId)
    : undefined
  const candidateVersion =
    gateCandidate ?? detail.versions.find((v) => v.id === detail.copilot.latestVersionId)

  // A proposal read that failed cannot be treated as "no proposal": that would
  // offer "Analyse" on an agent with an open cycle and 409 on click.
  const proposalUnreadable: Capability | null =
    proposalError === null
      ? null
      : unavailable(
          'Cannot read the improvement cycle',
          `The improvement_proposals read failed (${proposalError}), so whether a cycle is open is unknown. Acting on an unknown cycle state risks a duplicate proposal or a 409.`
        )

  // Derived once: `auto-improve` restates this verdict rather than re-deriving
  // it, so the two can never claim different things about the same engine.
  const runTests = testCapability(runtime, detail.copilot.projectId, suiteCount, suiteError)

  const capabilities: Record<LifecycleActionId, Capability> = {
    'generate-suite': generateSuiteCapability(hasManifest, suiteCount, suiteError),
    'run-tests': runTests,
    'run-benchmark': benchmarkCapability(runtime, detail.copilot.projectId, benchmarkError),
    'auto-improve':
      proposalUnreadable ?? autoImproveCapability(runTests, suiteCount, latestBenchmark, latestProposal),
    'create-v2': proposalUnreadable ?? createV2Capability(latestProposal),
    decide: proposalUnreadable ?? decideCapability(latestProposal),
    promote: promoteCapability(gate, gateError, productionVersion?.id ?? null),
    rollback: rollbackCapability(detail.versions, productionVersion),
  }

  return {
    copilotId,
    runtime,
    hasManifest,
    versions: detail.versions,
    productionVersion,
    candidateVersion,
    // `0` here is measured, and only reachable when the read succeeded — a
    // failed read is carried by the capabilities above, which say so in words.
    suiteCount: suiteCount ?? 0,
    latestBenchmark,
    latestProposal,
    gate,
    capabilities,
  }
}
