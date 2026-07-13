/**
 * Agent Mission Control — auto-evaluate a new agent (server only).
 *
 * Wires the two halves of "a new agent measures itself, zero clicks":
 *   1. ensureAgentSuites(copilotId) — generate + persist its test + benchmark
 *      suites (synchronous; fast — one completion — so the Quality tab is
 *      populated the moment the create response returns).
 *   2. runNewAgentEvaluation(copilotId) — run the test suite AND the benchmark
 *      suite against the copilot's real assistant, so its pass rate + score
 *      fill in on their own. Meant to be scheduled with Next's `after()` so it
 *      runs AFTER the HTTP response — the operator never waits on it and never
 *      clicks "run".
 *
 * Fail-soft throughout: a suite-run failure is logged, never thrown — a new
 * agent must still be created even if its first auto-eval hiccups (the operator
 * can re-run from the UI). Never fabricates a result — it calls the SAME real
 * runners the manual buttons use.
 *
 * Never import from a client component (real runners read service-role + OpenAI).
 */
import 'server-only'

import { runBenchmarkSuite } from './benchmark-runner'
import { pgrest } from './postgrest'
import { ensureAgentSuites } from './agent-suite-generator'
import { runTestSuite } from './test-runner'

type RawRow = Record<string, unknown>
const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`

/**
 * Generate the agent's suites now (synchronous) and return their ids so the
 * caller can hand them to `runNewAgentEvaluation` inside `after()`. Safe to call
 * on every create — it no-ops if the agent already has suites.
 */
export async function ensureAgentSuitesForNewAgent(
  copilotId: string
): Promise<{ testSuiteId: string; benchmarkSuiteId: string } | null> {
  try {
    return await ensureAgentSuites(copilotId)
  } catch (err) {
    console.error('[agent-autoeval] suite generation failed', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Run the agent's test suite + benchmark suite against its real assistant.
 * Fail-soft: each run is guarded independently so one failure doesn't skip the
 * other. Resolves the suite ids itself when not given (so it can be called with
 * just a copilotId from `after()`). No-op if the agent has no suites.
 */
export async function runNewAgentEvaluation(
  copilotId: string,
  suites?: { testSuiteId: string; benchmarkSuiteId: string } | null
): Promise<void> {
  let testSuiteId = suites?.testSuiteId ?? null
  let benchmarkSuiteId = suites?.benchmarkSuiteId ?? null

  if (!testSuiteId || !benchmarkSuiteId) {
    try {
      const [ts, bs] = await Promise.all([
        pgrest<RawRow[]>('GET', `test_suites?${eq('copilot_id', copilotId)}&select=id&order=id&limit=1`),
        pgrest<RawRow[]>('GET', `benchmark_suites?${eq('copilot_id', copilotId)}&select=id&order=id&limit=1`),
      ])
      testSuiteId = testSuiteId ?? ((ts[0]?.id as string) ?? null)
      benchmarkSuiteId = benchmarkSuiteId ?? ((bs[0]?.id as string) ?? null)
    } catch (err) {
      console.error('[agent-autoeval] failed to resolve suites', err instanceof Error ? err.message : err)
      return
    }
  }

  // Tests first (cheaper, faster) then benchmark. Independent guards.
  if (testSuiteId) {
    try {
      await runTestSuite({ copilotId, suiteId: testSuiteId, triggeredBy: 'auto-eval' })
    } catch (err) {
      console.error('[agent-autoeval] test run failed', err instanceof Error ? err.message : err)
    }
  }
  if (benchmarkSuiteId) {
    try {
      await runBenchmarkSuite({ copilotId, suiteId: benchmarkSuiteId })
    } catch (err) {
      console.error('[agent-autoeval] benchmark run failed', err instanceof Error ? err.message : err)
    }
  }
}

/**
 * The one call a create path makes: generate suites synchronously, then return
 * a thunk to schedule inside `after()` for the actual runs. Keeps the create
 * route's body a two-liner:
 *   const runEval = await prepareAutoEval(copilotId)
 *   after(runEval)
 */
export async function prepareAutoEval(copilotId: string): Promise<() => Promise<void>> {
  const suites = await ensureAgentSuitesForNewAgent(copilotId)
  return () => runNewAgentEvaluation(copilotId, suites)
}
