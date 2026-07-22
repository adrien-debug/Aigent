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
 * The only runtime `test-runner.ts` and the graph path of `benchmark-runner.ts`
 * can honestly serve. Both resolve an assistant on the LangGraph Agent Server;
 * nothing else has a graph to route to.
 */
const GRAPH_RUNTIME = 'langgraph'

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
 * The runtime gap, stated once (see AGENTS.md / benchmark-runner.ts:804).
 *
 * `test-runner.ts` has NO runtime branch: `runCase` always calls
 * `streamOnAgentServer` with an assistant resolved by `resolveRunAssistantFromRow`.
 * There is no non-graph path in that module at all. Running the suite on an
 * `openai-assistants` copilot therefore executes it on a runtime that is not
 * its own, and the resulting pass rate describes the graph, not the agent.
 */
function testCapability(runtime: string | null, suiteCount: number | null, suiteError: string | null): Capability {
  if (suiteError !== null) {
    return unavailable(
      'Cannot read this agent’s test suites',
      `The test_suites read failed (${suiteError}), so the number of suites is unknown. It is not zero — it is unread.`
    )
  }
  if (runtime !== GRAPH_RUNTIME) {
    return unavailable(
      `Test runner only executes on the ${GRAPH_RUNTIME} runtime`,
      `test-runner.ts has no runtime branch: runCase() always calls streamOnAgentServer() with an assistant from resolveRunAssistantFromRow(). Running this ${runtime ?? 'unset'} agent’s suite would execute it on the LangGraph Agent Server — a runtime that is not its own — and the pass rate would describe the graph, not this agent.`
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
 * Benchmarks run on any runtime, but only the graph path proves anything.
 * `benchmark-runner.ts:804` sets `usesRealGraph = runtime === 'langgraph'`;
 * anything else falls to `runTaskViaCompletion`, which makes no tool call, so
 * the safety assertions have nothing to observe and `TaskOutcome.ranOnGraph`
 * withholds the safety score rather than fabricate one.
 */
function benchmarkCapability(runtime: string | null, benchmarkError: string | null): Capability {
  if (benchmarkError !== null) {
    return unavailable(
      'Cannot read this agent’s benchmark history',
      `The benchmark_suites/benchmark_runs read failed (${benchmarkError}). Launching a benchmark without knowing the current state would produce a comparison against an unknown baseline.`
    )
  }
  if (runtime !== GRAPH_RUNTIME) {
    return degraded(
      'Runs without tools — no safety score',
      `benchmark-runner.ts:804 sets usesRealGraph = runtime === '${GRAPH_RUNTIME}'. This ${runtime ?? 'unset'} agent falls to runTaskViaCompletion(): a direct completion with no tool call, so unsafe-action and confirmation counts are never observed and TaskOutcome.ranOnGraph withholds the safety score. The accuracy figure describes the model’s prose, not this agent’s behaviour.`
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
 * below the improve target. On a runtime whose suite cannot be executed
 * (see `testCapability`), the first half of that signal can never exist —
 * saying so up front is more honest than letting the cycle burn an LLM call to
 * discover it.
 */
function autoImproveCapability(
  runtime: string | null,
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

  if (runtime !== GRAPH_RUNTIME) {
    return unavailable(
      'No improvement signal this agent can produce',
      `collectImprovementSignals() reads failing cases from completed test_runs and scores from benchmark_runs. This ${runtime ?? 'unset'} agent cannot run its test suite (test-runner.ts is LangGraph-only), and its benchmark path makes no tool calls, so no failing case and no sub-target score (< ${IMPROVEMENT_MIN_BENCHMARK_SCORE}) can be recorded. analyzeAndPropose() would throw "nothing to improve".`
    )
  }
  if (suiteCount === 0) {
    return unavailable(
      'No test suite, no benchmark below target',
      `collectImprovementSignals() has nothing to read: no test_suites row for this copilot, and no benchmark scoring under ${IMPROVEMENT_MIN_BENCHMARK_SCORE}. analyzeAndPropose() would throw "nothing to improve".`
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
function promoteCapability(gate: ReleaseGate | null, gateError: string | null): Capability {
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
  const candidateVersion =
    (gate ? detail.versions.find((v) => v.id === gate.candidateVersionId) : undefined) ??
    detail.versions.find((v) => v.id === detail.copilot.latestVersionId)

  // A proposal read that failed cannot be treated as "no proposal": that would
  // offer "Analyse" on an agent with an open cycle and 409 on click.
  const proposalUnreadable: Capability | null =
    proposalError === null
      ? null
      : unavailable(
          'Cannot read the improvement cycle',
          `The improvement_proposals read failed (${proposalError}), so whether a cycle is open is unknown. Acting on an unknown cycle state risks a duplicate proposal or a 409.`
        )

  const capabilities: Record<LifecycleActionId, Capability> = {
    'generate-suite': generateSuiteCapability(hasManifest, suiteCount, suiteError),
    'run-tests': testCapability(runtime, suiteCount, suiteError),
    'run-benchmark': benchmarkCapability(runtime, benchmarkError),
    'auto-improve':
      proposalUnreadable ?? autoImproveCapability(runtime, suiteCount, latestBenchmark, latestProposal),
    'create-v2': proposalUnreadable ?? createV2Capability(latestProposal),
    decide: proposalUnreadable ?? decideCapability(latestProposal),
    promote: promoteCapability(gate, gateError),
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
