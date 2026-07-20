/**
 * Agent Mission Control — multi-model benchmark sweep.
 *
 * Runs the SAME benchmark suite across several models, one after the other,
 * so a model is chosen on evidence instead of intuition. The local vLLM park
 * is priced at 0 (model-pricing.ts), so sweeping the five `local` ids costs
 * nothing but round-trips.
 *
 * DESIGN RULES (all of them are truth rules, not style):
 *
 *  1. NO RUNNER LOGIC IS DUPLICATED. Each leg calls `runBenchmarkSuite` with a
 *     per-run model/provider override, so every leg persists a normal
 *     `benchmark_runs` + `benchmark_results` pair attributed to the model that
 *     actually executed. A sweep leaves no special-cased rows behind.
 *
 *  2. SEQUENTIAL, ALWAYS. The vLLM endpoints are single-tenant GPUs; firing
 *     legs concurrently would queue at the server and distort latency — which
 *     feeds `compositeScore`. Cost is counted in round-trips, never wall-clock.
 *
 *  3. A MODEL THAT CANNOT RUN IS `skipped`, NEVER SCORED 0. A 0 means "answered
 *     badly"; a context window too small, or a provider that is not configured,
 *     means "did not answer". Both are decided BEFORE the call and reported
 *     with a machine-readable `skipReason`.
 *
 *  4. NO SILENT FALLBACK. A skipped model is never quietly replaced by another
 *     one, and `allowFallback` defaults to false for the whole sweep: a leg
 *     that silently ran on a different model would poison the comparison.
 *
 * ---------------------------------------------------------------------------
 * TRUTH RESERVE — WHAT A SWEEP MEASURES ON THE `langgraph` RUNTIME
 * ---------------------------------------------------------------------------
 * Verified in `benchmark-runner.ts`:
 *   - runtime !== 'langgraph' → `runTaskViaCompletion(prompt, routes, model,
 *     modelProvider, ...)`: the override drives the agent itself. The sweep is
 *     a true model comparison.
 *   - runtime === 'langgraph' → `runTaskOnGraph(...)` calls
 *     `runOnAgentServer({ userInput, assistantId, maxSteps })`. That call takes
 *     NO model and NO provider: the graph picks its own model from the
 *     assistant's `CopilotBehaviorConfig` (see src/langgraph/model-provider.mjs).
 *     The override then reaches ONLY the LLM judge (`routeCompletion({ purpose:
 *     'judge', model, modelProvider })`).
 * So on `langgraph`, a sweep compares GRADERS, not agents — the agent under
 * test is identical in every leg. That would be a dishonest "model comparison",
 * so `runBenchmarkSweep` refuses it by default: legs are reported as skipped
 * with `runtime-not-swept` unless the caller explicitly opts in via
 * `allowJudgeOnlySweep: true`, in which case every leg is flagged
 * `sweepScope: 'judge-only'`.
 */
import 'server-only'

import { LOCAL_VLLM_ENDPOINTS } from './model-local'
import { providerAvailable } from './model-router'
import { estimateTokens } from './model-pricing'
import { runBenchmarkSuite, type RunBenchmarkSuiteArgs } from './benchmark-runner'
import type { AgentRuntime, BenchmarkRun, ModelProvider } from './types'

/** Why a model never ran. Never conflated with a low score. */
export type SweepSkipReason =
  | 'provider-unavailable'
  | 'context-window-too-small'
  | 'runtime-not-swept'

/** What the numbers of a leg actually describe. */
export type SweepScope = 'agent' | 'judge-only'

export interface SweepModelSpec {
  model: string
  modelProvider: ModelProvider
}

export interface SweepLegRan {
  status: 'ran'
  model: string
  modelProvider: ModelProvider
  /** `agent` = the override drove the agent. `judge-only` = it drove the grader only. */
  sweepScope: SweepScope
  run: BenchmarkRun
  /** Composite 0..100 when the leg produced a result, else null. Never 0-as-unknown. */
  score: number | null
  contextTokens: number | null
}

export interface SweepLegSkipped {
  status: 'skipped'
  model: string
  modelProvider: ModelProvider
  skipReason: SweepSkipReason
  /** Operator-facing explanation. */
  detail: string
  contextTokens: number | null
}

export interface SweepLegFailed {
  status: 'failed'
  model: string
  modelProvider: ModelProvider
  /** The runner threw — this is an execution fault, not a quality verdict. */
  error: string
  contextTokens: number | null
}

export type SweepLeg = SweepLegRan | SweepLegSkipped | SweepLegFailed

export interface BenchmarkSweepResult {
  copilotId: string
  suiteId: string
  versionId?: string
  runtime: AgentRuntime
  /** Legs in execution order — sequential, so this is also chronological. */
  legs: SweepLeg[]
  ranCount: number
  skippedCount: number
  failedCount: number
  /** Best scoring leg, or null when nothing produced a score. Ties → first run. */
  best: { model: string; modelProvider: ModelProvider; score: number } | null
  /** True when at least one leg's numbers describe the agent itself. */
  comparesAgents: boolean
}

export interface RunBenchmarkSweepArgs {
  copilotId: string
  suiteId: string
  versionId?: string
  models: readonly SweepModelSpec[]
  /**
   * Runtime of the copilot under test. Drives the langgraph truth reserve
   * above; callers should pass the copilot's real runtime.
   */
  runtime: AgentRuntime
  triggeredBy?: string
  /**
   * Opt in to sweeping a `langgraph` copilot, accepting that only the judge
   * varies between legs. Off by default.
   */
  allowJudgeOnlySweep?: boolean
  /**
   * Texts the model will have to hold in context for one task (system prompt,
   * task input, expected behaviour…). Used only to size the context-fit guard.
   * Omitted → the guard reports `contextTokens` but cannot skip: an unknown
   * demand never fabricates a verdict in either direction.
   */
  contextProbeTexts?: readonly string[]
  /** Tokens reserved for the completion on top of the prompt estimate. */
  reservedOutputTokens?: number
}

/** Injection seam — production defaults; tests substitute them. */
export interface BenchmarkSweepDeps {
  runSuite: (args: RunBenchmarkSuiteArgs) => Promise<BenchmarkRun>
  /** Provider+model configured and reachable-by-config (never a network probe). */
  isAvailable: (spec: SweepModelSpec) => boolean
  /** Declared context window, or null when the provider does not declare one. */
  contextTokensFor: (spec: SweepModelSpec) => number | null
  /** Composite score of a finished run, or null when unavailable. */
  scoreFor: (run: BenchmarkRun) => Promise<number | null>
}

const DEFAULT_RESERVED_OUTPUT_TOKENS = 1024

/**
 * Prompt-size estimate for the context-fit guard.
 *
 * Delegates to the router's own `estimateTokens` on purpose: the number it
 * produces is compared against the SAME `contextTokens` the router checks at
 * call time (model-router.ts). Two estimators would eventually disagree about
 * whether a model fits, and the sweep would skip legs the router accepts.
 */
export function estimatePromptTokens(texts: readonly string[]): number {
  if (texts.length === 0) return 0
  // Joined WITHOUT a separator: a separator would inflate the estimate by one
  // char per text, which is noise the router's own estimate does not carry.
  return estimateTokens(texts.join(''))
}

/** Availability is judged by the router itself — never re-derived here. */
function defaultIsAvailable(spec: SweepModelSpec): boolean {
  return providerAvailable(spec.modelProvider, spec.model)
}

function defaultContextTokensFor(spec: SweepModelSpec): number | null {
  if (spec.modelProvider !== 'local') return null
  return spec.model in LOCAL_VLLM_ENDPOINTS
    ? LOCAL_VLLM_ENDPOINTS[spec.model as keyof typeof LOCAL_VLLM_ENDPOINTS].contextTokens
    : null
}

/** Score is only read from a finished run; a run without a result stays null. */
async function defaultScoreFor(run: BenchmarkRun): Promise<number | null> {
  if (run.status !== 'completed' || !run.resultId) return null
  const { pgrest } = await import('./postgrest')
  const rows = await pgrest<Array<{ score: number | null }>>(
    'GET',
    `benchmark_results?id=eq.${encodeURIComponent(run.resultId)}&select=score`
  )
  const raw = rows[0]?.score
  return typeof raw === 'number' ? raw : null
}

function defaultDeps(): BenchmarkSweepDeps {
  return {
    runSuite: runBenchmarkSuite,
    isAvailable: defaultIsAvailable,
    contextTokensFor: defaultContextTokensFor,
    scoreFor: defaultScoreFor,
  }
}

/**
 * Run one benchmark suite across several models, sequentially.
 *
 * Every model yields exactly one leg, in the order given. Legs never fall back
 * onto another model and a model that could not run is `skipped`, not scored.
 */
export async function runBenchmarkSweep(
  args: RunBenchmarkSweepArgs,
  deps: Partial<BenchmarkSweepDeps> = {}
): Promise<BenchmarkSweepResult> {
  const d = { ...defaultDeps(), ...deps }
  const judgeOnly = args.runtime === 'langgraph'
  const refuseRuntime = judgeOnly && args.allowJudgeOnlySweep !== true

  const demand =
    args.contextProbeTexts && args.contextProbeTexts.length > 0
      ? estimatePromptTokens(args.contextProbeTexts) +
        (args.reservedOutputTokens ?? DEFAULT_RESERVED_OUTPUT_TOKENS)
      : null

  const legs: SweepLeg[] = []

  for (const spec of args.models) {
    const contextTokens = d.contextTokensFor(spec)

    if (refuseRuntime) {
      legs.push({
        status: 'skipped',
        ...spec,
        skipReason: 'runtime-not-swept',
        detail:
          'runtime is `langgraph`: the graph picks its own model, so the override would only vary the judge. Pass allowJudgeOnlySweep to accept a judge-only comparison.',
        contextTokens,
      })
      continue
    }

    if (!d.isAvailable(spec)) {
      legs.push({
        status: 'skipped',
        ...spec,
        skipReason: 'provider-unavailable',
        detail: `provider \`${spec.modelProvider}\` is not configured for model \`${spec.model}\` — skipped, not substituted.`,
        contextTokens,
      })
      continue
    }

    if (demand !== null && contextTokens !== null && demand > contextTokens) {
      legs.push({
        status: 'skipped',
        ...spec,
        skipReason: 'context-window-too-small',
        detail: `tasks need ~${demand} tokens, window is ${contextTokens} — skipped before the call so it is never recorded as a 0 score.`,
        contextTokens,
      })
      continue
    }

    try {
      // Sequential on purpose: one vLLM endpoint at a time, never a burst.
      const run = await d.runSuite({
        copilotId: args.copilotId,
        suiteId: args.suiteId,
        versionId: args.versionId,
        model: spec.model,
        modelProvider: spec.modelProvider,
        runtime: args.runtime,
        triggeredBy: args.triggeredBy,
        allowFallback: false,
      })
      const score = await d.scoreFor(run)
      legs.push({
        status: 'ran',
        ...spec,
        sweepScope: judgeOnly ? 'judge-only' : 'agent',
        run,
        score,
        contextTokens,
      })
    } catch (err) {
      legs.push({
        status: 'failed',
        ...spec,
        error: err instanceof Error ? err.message : String(err),
        contextTokens,
      })
    }
  }

  const ran = legs.filter((l): l is SweepLegRan => l.status === 'ran')
  let best: BenchmarkSweepResult['best'] = null
  for (const leg of ran) {
    if (leg.score === null) continue
    if (best === null || leg.score > best.score) {
      best = { model: leg.model, modelProvider: leg.modelProvider, score: leg.score }
    }
  }

  return {
    copilotId: args.copilotId,
    suiteId: args.suiteId,
    versionId: args.versionId,
    runtime: args.runtime,
    legs,
    ranCount: ran.length,
    skippedCount: legs.filter((l) => l.status === 'skipped').length,
    failedCount: legs.filter((l) => l.status === 'failed').length,
    best,
    comparesAgents: ran.some((l) => l.sweepScope === 'agent'),
  }
}
