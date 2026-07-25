/**
 * AIGENT-DETERMINISTIC-EVIDENCE-001 — the injectable execution seam shared by the
 * test runner and the benchmark runner.
 *
 * A test/benchmark run makes exactly TWO calls that reach a billed LLM:
 *   1. the AGENT leg — run the case/task input on the copilot's own runtime
 *      (LangGraph Agent Server, or the direct model-router loop);
 *   2. the JUDGE leg — a strict-JSON grader completion.
 * Everything else the runners do (loading the suite, the ground-truth tool-call
 * gate, the deterministic safety assertions, aggregation, and — crucially — the
 * persistence into test_runs/benchmark_runs and the release gate that reads them)
 * is pure of the model and must STAY that way.
 *
 * This interface is that seam. Injecting it lets a caller swap ONLY the two
 * billed legs — for a $0, reproducible, offline PROOF — while the persisted rows,
 * their shape, and the gate that consumes them are byte-for-byte the ones a real
 * run produces. It is the same "inject the runner" idea the shadow/replay engines
 * already use (`ShadowRunAgent`, `ReplayRunner`), generalised to the two runners
 * that had no such seam and therefore forced the factory proof to write evidence
 * rows directly. The mission's suggested names (`AgentRunAdapter`,
 * `ModelExecutionAdapter`) both land here: it abstracts the agent RUN and the
 * model-facing JUDGE behind one contract.
 *
 * PURE CONTRACT: types only, no server-only import. The live implementation
 * (live-adapter.ts) is server-only because it reaches the engines; the
 * deterministic implementation (deterministic-adapter.ts) is offline. The runners
 * default to the live adapter, so a normal user run is unchanged.
 */
import type { AgentRuntime, ModelProvider } from '../types'

/**
 * How a run's two billed legs were executed. Mirrors the DB `execution_mode`
 * column (migration 0037) one-to-one, so the label a run persists is exactly the
 * adapter that produced it.
 */
export type EvidenceExecutionMode = 'live' | 'deterministic'

/**
 * The DB value each mode persists to `test_runs.execution_mode` /
 * `benchmark_runs.execution_mode` (migration 0037).
 *
 * ⚠️ VOCABULARY DIVERGENCE — DO NOT CROSS-COMPARE. This column shares its NAME
 * with `shadow_experiments`/`replay_comparisons.execution_mode` (migration 0034)
 * but NOT its values: here it is `'live' | 'deterministic-fixture'`; there it is
 * `'live_langgraph' | 'deterministic_fixture' | 'legacy_unknown'`. They live on
 * different tables with different consumers (this one → release-gate test/bench
 * evidence; the other → promotion-gate shadow/replay provenance). Any future code
 * that reads `execution_mode` MUST know which table it came from — a string
 * equality across the two is always wrong.
 */
export const EVIDENCE_MODE_DB_LABEL: Readonly<Record<EvidenceExecutionMode, string>> = {
  live: 'live',
  deterministic: 'deterministic-fixture',
}

/**
 * One tool call as ground truth: the tool NAME and the runtime status the engine
 * reported for it. `status` is the same vocabulary both engines already use —
 * 'ok' | 'error' | 'blocked' (LangGraph) plus 'rejected' (direct loop). A
 * 'blocked'/'rejected' call was requested by the model but never executed; the
 * safety assertions treat only executed calls as violations.
 */
export interface EvidenceToolCall {
  toolName: string
  status?: string
}

/**
 * Everything the agent leg needs to run one case/task input on the copilot's
 * runtime. The runner resolves all of this ONCE per suite and hands it in per
 * case, unchanged between adapters — the live adapter uses every field, the
 * deterministic one uses only `input` (and reads the rest as inert context).
 */
export interface AgentLegRequest {
  copilotId: string
  runtime: AgentRuntime
  /** The case/task input text the agent must answer. */
  input: string
  maxSteps: number
  /** Version under test — pins the direct engine's run to a real version row. */
  versionId: string
  /** '' for a bench copilot with no project (rejected up front on the direct path). */
  projectId: string
  model: string
  modelProvider: ModelProvider
  systemPromptSummary: string
  /** Distinguishes test-case runs from benchmark-task runs on the health surfaces. */
  userLabel: string
  /** The copilot's resolved LangGraph assistant (undefined → shared graph id). */
  assistantId: string | undefined
  /**
   * True → the langgraph agent leg STREAMS (streamOnAgentServer) so the caller
   * can animate a live canvas; false → the blocking runOnAgentServer. The final
   * graded result is identical either way. The test runner streams; the
   * benchmark runner does not. Ignored by the deterministic adapter.
   */
  stream?: boolean
  /** Live progress sinks, forwarded only on the streaming langgraph path. */
  onNode?: (node: string) => void
  onThread?: (threadId: string) => void
}

/**
 * The normalised ground truth of one agent run, whichever engine (or fixture)
 * produced it. This is exactly the shape both runners already reconstructed
 * internally — `CaseExecution` in test-runner.ts, the `gr`/`res` reads in
 * benchmark-runner.ts — unified so the downstream judge/gate/safety code is
 * engine-agnostic and stays that way.
 */
export interface AgentLegResult {
  /** Tool names attempted (executed OR blocked/rejected), with runtime status. */
  toolCalls: EvidenceToolCall[]
  /**
   * The reply the judge grades and the operator reads. ALREADY annotated for a
   * pause (`[interrupted for human confirmation] …` / `[blocked pending human
   * confirmation] …`) by whichever adapter produced it, so the annotation is
   * identical to today on the live path and honest on the fixture path.
   */
  reply: string
  /** True when the agent STOPPED and asked a human before acting (real, never a default). */
  pausedForConfirmation: boolean
  /** The tool the agent was waiting on approval for, when it paused. */
  pendingToolName: string | null
  /** null = unmeasured (no readable usage) — never a fabricated 0. Fixture is honestly 0. */
  costUsd: number | null
}

/** Which runner is grading — the two use different strict-JSON judge shapes. */
export type JudgePurpose = 'test' | 'benchmark'

/**
 * The judge leg: grade one reply. The runner builds the exact payload it always
 * built; the adapter turns it into a verdict. `payload` carries `input`, so a
 * deterministic judge can look up the scenario for that case without re-deriving
 * anything.
 */
export interface JudgeLegRequest {
  purpose: JudgePurpose
  systemPrompt: string
  /** The object the runner would JSON.stringify — includes `input`, `actualReply`, etc. */
  payload: Record<string, unknown>
  model: string
  modelProvider: ModelProvider
}

/**
 * The judge's answer: the STRICT JSON the runner parses (safeParseGrade /
 * safeParseBenchGrade), plus the cost of producing it. The runner is unchanged —
 * it still parses `text`, so an unparseable judge still maps to an honest error,
 * never a fabricated pass. Fixture cost is honestly 0.
 */
export interface JudgeLegResult {
  text: string
  costUsd: number
}

/**
 * The seam. A runner is handed one of these (defaulting to the live adapter) and
 * calls `executeAgent` then `judge` per case; nothing else about the runner
 * changes. `mode`/`label` flow into the persisted `execution_mode` column so the
 * evidence is honestly provenanced and a fixture proof can NEVER be mistaken for
 * a billed one.
 */
export interface EvidenceExecutionAdapter {
  readonly mode: EvidenceExecutionMode
  /** DB value for `execution_mode` — exactly EVIDENCE_MODE_DB_LABEL[mode]. */
  readonly label: string
  executeAgent(request: AgentLegRequest): Promise<AgentLegResult>
  judge(request: JudgeLegRequest): Promise<JudgeLegResult>
}
