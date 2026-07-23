/**
 * Agent Mission Control — domain types.
 *
 * V1 is mock-only: no backend, no LangGraph/LangSmith/OpenAI calls.
 * These types are the contract for the future wiring (LangGraph runtimes,
 * LangSmith traces, Supabase persistence) — keep IDs, timestamps and
 * foreign-key shapes stable.
 */

// ---------------------------------------------------------------------------
// Shared scalars
// ---------------------------------------------------------------------------

/** ISO 8601 timestamp, e.g. "2026-07-09T14:32:00Z". */
export type IsoTimestamp = string

/** USD amount (e.g. 0.0342). */
export type UsdAmount = number

/** Milliseconds. */
export type DurationMs = number

// ---------------------------------------------------------------------------
// Projects & copilots
// ---------------------------------------------------------------------------

export interface Project {
  id: string
  name: string
  slug: string
  description: string
  /** Header/banner photo (landscape), shown at the top of the project card. */
  imageUrl?: string
  /** Square logo shown in the card avatar. */
  logoUrl?: string
  /** GitHub repo lié au projet (1:1), ex. "https://github.com/hearst/console". */
  repoUrl?: string
  /** owner/repo, ex. "hearst/console" — dérivé/source pour l'API GitHub. */
  repoFullName?: string
  platform: 'web' | 'desktop' | 'mobile' | 'api'
  createdAt: IsoTimestamp
}

export type AgentRuntime =
  | 'langgraph'
  | 'openai-assistants'
  | 'gemini'
  | 'custom'

/** Restriction du runtime autorisé côté API/formulaire de création — voir copilots/route.ts. */
export type CreatableAgentRuntime = Extract<AgentRuntime, 'langgraph'>

export type CopilotStatus = 'active' | 'paused' | 'draft' | 'degraded' | 'archived'

export type AgentPushStatus = 'never' | 'pushing' | 'pushed' | 'failed'

export type ModelProvider = 'openai' | 'google' | 'local'

export interface Copilot {
  id: string
  /**
   * Projet d'affectation. `null` = copilote sur le BANC DE VALIDATION :
   * il se teste/rode et n'a pas encore été validé. L'affectation à un
   * projet est l'acte de validation.
   */
  projectId: string | null
  /** Destination(s) de développement pendant le rodage (0..2 projets visés). */
  targetProjectIds: string[]
  name: string
  slug: string
  description: string
  runtime: AgentRuntime
  status: CopilotStatus
  /** Version currently serving production traffic. */
  productionVersionId: string | null
  /** Latest version, may be draft/beta. */
  latestVersionId: string
  model: string
  modelProvider: ModelProvider
  owner: string
  tags: string[]
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
  /** Rolled-up health signals for registry/overview surfaces. */
  health: CopilotHealth
  /** Dernier push du code de l'agent vers le repo GitHub du projet. */
  lastPushStatus?: AgentPushStatus
  lastPushedAt?: IsoTimestamp
  lastPushCommitUrl?: string
  /**
   * Display status derived from the production pointer at read time (data.ts),
   * NOT stored in DB. `'production'` when a version is serving production even
   * though `status` still reads `draft`. Undefined outside the enriched getters.
   * Display-only — never gates anything; the raw `status` column is untouched.
   */
  displayStatus?: DisplayStatus
  /**
   * Whether `health.testPassRate`/`benchmarkScore` came from real completed runs
   * (`runs`) or are the stored baseline with no run yet (`none`). Set by the
   * enriched getters; drives "not measured" vs a real number in the UI.
   */
  healthEvidence?: 'runs' | 'none'
  /**
   * Health metrics that NO persisted row proved — same channel as
   * `AvailableAgent.unavailableFields`: a metric named here means the number
   * sitting in `health` is a normalisation placeholder, not a measurement, and
   * MUST render as a dash. Set by `data.ts` (`enrichCopilot`) at read time.
   *
   * `undefined` means the row never went through the data layer, so nothing is
   * proven — a consumer must treat every metric as unavailable, not as measured.
   */
  healthUnavailableFields?: CopilotHealthMetric[]
}

/** See `agent-health.ts` — display status decoupled from the stored column. */
export type DisplayStatus = CopilotStatus | 'production'

/**
 * Rolled-up health signals.
 *
 * A number here is a MEASUREMENT and `0` is a real one ("the window was read
 * and held nothing"). The stored `copilots.health` jsonb is written PARTIAL
 * though — `scripts/provision-tradeagent-roster.mjs` inserts `health: {}` — and
 * `camelRows` casts the blob without validating it, so a raw row can carry
 * `undefined` under every key. That is how the Performance page summed
 * `undefined` into `NaN` and rendered it as a measurement.
 *
 * `data.ts` therefore normalises the blob at read time and names whatever it
 * could not prove in `Copilot.healthUnavailableFields`. Never read a metric
 * here without checking that list first.
 */
export interface CopilotHealth {
  testPassRate: number // 0..1
  benchmarkScore: number // 0..100
  runsLast24h: number
  errorRateLast24h: number // 0..1
  avgLatencyMs: DurationMs
  /**
   * PHANTOM METRIC — no producer. Grep proved (2026-07-23) that NO writer ever
   * increments `openWarnings` from a real signal: every path that sets it writes
   * a literal (`authoring-writes.ts` / `provision-agent-builder-live.ts` seed
   * `0`; `seed-fixtures.ts` hard-codes static 0/1/3; the trading persist script
   * hard-codes `0`). There is no incident/alert table it rolls up, no resolver,
   * no run-backed recompute. So a `openWarnings: 0` in a live `health` blob is a
   * DEFAULT, never a measurement of "the fleet is clean".
   *
   * `data.ts#normalizeHealth` therefore always names it in
   * `healthUnavailableFields` (the blob is `{}` for the provisioned roster, and
   * no resolver ever `prove()`s it), so `openWarnings` here is a placeholder for
   * the typed shape. Read it ONLY through the `healthUnavailableFields` /
   * `isMeasured` channel — a bare `.openWarnings` is a phantom read. Aggregate
   * surfaces expose it as `{ value: null, state: 'UNAVAILABLE' }`
   * (see `RegistryKpis` / `ProjectOverviewItem`), never a summed 0.
   */
  openWarnings: number
  costLast24hUsd: UsdAmount
}

/** One rolled-up health metric — the key space of `healthUnavailableFields`. */
export type CopilotHealthMetric = keyof CopilotHealth

/**
 * Explicit measurement state for a value that may not be measurable. The whole
 * point of the "doctrine des chiffres": a value nobody could measure travels as
 * `null` + a state, NEVER as a fabricated `0`.
 *
 * - `MEASURED` — a real reading (including a real `0`).
 * - `UNKNOWN` — not read this pass (skipped, e.g. a `list`-mode health fan-out).
 * - `UNAVAILABLE` — structurally unmeasurable: no producer exists at all.
 * - `STALE` — last reading is past its freshness window.
 * - `NOT_APPLICABLE` — the metric does not apply to this subject.
 */
export type MeasurementState = 'MEASURED' | 'UNKNOWN' | 'UNAVAILABLE' | 'STALE' | 'NOT_APPLICABLE'

/**
 * A numeric metric that carries its own measurement state. `value` is `null`
 * whenever `state !== 'MEASURED'`; a consumer must render a dash (or the state)
 * rather than treating a missing value as `0`.
 */
export interface MeasuredNumber {
  value: number | null
  state: MeasurementState
}

export type VersionStage = 'production' | 'beta' | 'draft' | 'archived'

export interface CopilotVersion {
  id: string
  copilotId: string
  /** Semver-ish label, e.g. "v3.2.0". */
  label: string
  stage: VersionStage
  manifestId: string
  model: string
  modelProvider: ModelProvider
  changelog: string
  createdAt: IsoTimestamp
  createdBy: string
  scores: {
    testPassRate: number // 0..1
    benchmarkScore: number // 0..100
    shadowAgreement: number | null // 0..1, null if never shadowed
    /**
     * Unsafe actions counted by the latest completed benchmark run pinned to
     * this version. `null` = never measured — NOT the same claim as `0`, which
     * asserts a run looked and found none. A version that was never
     * benchmarked, or whose run recorded nothing, must read `null`.
     */
    unsafeActionCount: number | null
  }
  /**
   * Whether `scores.testPassRate`/`benchmarkScore` came from real completed runs
   * pinned to this version (`runs`) or are the stored zero baseline (`none`).
   * Set by `getVersionsForCopilot`; lets the UI show "not measured" for a
   * genuinely un-run version instead of a false 0.0%.
   */
  scoresEvidence?: 'runs' | 'none'
}

// ---------------------------------------------------------------------------
// Manifests
// ---------------------------------------------------------------------------

export type ConfirmationPolicy = 'never' | 'risky-only' | 'always'

export interface AgentManifest {
  id: string
  copilotId: string
  version: string
  systemPromptSummary: string
  /** Route/domain allowlist the agent may operate on. */
  allowedRoutes: string[]
  /** Hard-forbidden behaviours, enforced by the runtime gate. */
  forbiddenActions: string[]
  confirmationPolicy: ConfirmationPolicy
  /** Which actions always require human confirmation regardless of policy. */
  alwaysConfirmActions: string[]
  memorySources: MemorySource[]
  outputContract: OutputContract
  /** Mission-level capabilities the agent performs to fulfil its job. */
  skills: AgentSkill[]
  toolIds: string[]
  maxStepsPerRun: number
  maxCostPerRunUsd: UsdAmount
  updatedAt: IsoTimestamp
  /**
   * Opt-in runtime telemetry for the DELIVERED agent (prompt 62). Absent or
   * `enabled: false` → the generator still emits `telemetry.ts` alongside the
   * handler whenever this field is present, but it is a runtime no-op unless
   * the consumer repo also sets `AIGENT_TELEMETRY_ENABLED=true` at deploy time.
   * Undefined entirely → no telemetry.ts is generated at all (back-compat).
   */
  telemetry?: {
    /** Default: `false` — telemetry is opt-in, never on by generation alone. */
    enabled: boolean
    /** POST target; falls back to `AIGENT_TELEMETRY_ENDPOINT` env at runtime. */
    endpoint?: string
    projectId?: string
    agentId?: string
    /** Fraction of runs sampled, 0..1. Default: `1` (all runs, once enabled). */
    sampleRate?: number
    /** Default: `true` — strip raw input content, keep only shape/counters. */
    redactInputs?: boolean
    /** Default: `true` — strip raw output content, keep only shape/counters. */
    redactOutputs?: boolean
  }
}

export interface MemorySource {
  id: string
  name: string
  kind: 'vector-store' | 'sql' | 'document' | 'session' | 'api'
  scope: 'user' | 'project' | 'global'
  readOnly: boolean
}

/**
 * The persisted `manifests.output_contract` jsonb — an AUTHOR-DEFINED contract
 * whose shape varies by authoring path, so every field is optional and nothing
 * here may be asserted non-null at runtime:
 *   - fixtures / create-agent-form / agent-builder write `{format, schemaName,
 *     invariants}`;
 *   - the live trading/architect roster writes `{fields, version}`.
 * Declaring one rigid shape lied about half the live rows (a reader touching
 * `.invariants` on a `{fields,version}` row got `undefined`). Readers must treat
 * this as a loose contract blob and default every field.
 */
export interface OutputContract {
  format?: 'json' | 'markdown' | 'text' | 'ui-actions'
  schemaName?: string | null
  /** Human-readable invariants, e.g. "never returns raw SQL". */
  invariants?: string[]
  /** Structured output field names (trading/architect shape). */
  fields?: string[]
  /** Contract version (trading/architect shape). */
  version?: string
}

export interface AgentSkill {
  /** Mission-level capability, phrased as a product verb, e.g. "Read BTCUSDT spot price". */
  label: string
  /** Optional one-line explanation of how the agent realises it. */
  detail?: string
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface ToolDefinition {
  id: string
  name: string
  description: string
  provider: 'internal' | 'composio' | 'mcp' | 'http'
  riskLevel: ToolRiskLevel
  enabled: boolean
  requiresConfirmation: boolean
  /**
   * Does this tool write, send, publish or spend anything? (migration 0022,
   * `not null default true` — fail-closed.) This is the tool's NATURE and the
   * only honest basis for calling it read-only; `requiresConfirmation` is a
   * POLICY and a mutating tool whose author never asked for a confirmation is
   * still mutating. Optional here because the mock fixtures predate the column:
   * `undefined` ⇒ nature unknown, never "read-only".
   */
  mutates?: boolean
  /** Routes this tool is allowed to touch; subset of manifest allowedRoutes. */
  scopedRoutes: string[]
  lastUsedAt: IsoTimestamp | null
  lastErrorAt: IsoTimestamp | null
  lastErrorMessage: string | null
  callsLast7d: number
  errorRateLast7d: number // 0..1
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export interface TestSuite {
  id: string
  copilotId: string
  name: string
  description: string
  kind: 'behavior' | 'safety' | 'regression' | 'output-contract'
  caseIds: string[]
  lastRunId: string | null
}

export interface TestCase {
  id: string
  suiteId: string
  name: string
  input: string
  expectedBehavior: string
  /** Tool calls the agent is expected to make (names). */
  expectedToolCalls: string[]
  tags: string[]
}

export type TestResultStatus = 'pass' | 'fail' | 'error' | 'skip' | 'running'

export interface TestRun {
  id: string
  suiteId: string
  copilotId: string
  versionId: string
  triggeredBy: string
  startedAt: IsoTimestamp
  finishedAt: IsoTimestamp | null
  status: 'queued' | 'running' | 'completed' | 'aborted'
  resultIds: string[]
  passRate: number // 0..1
  totalCostUsd: UsdAmount
}

export interface TestResult {
  id: string
  runId: string
  caseId: string
  status: TestResultStatus
  actualBehavior: string
  actualToolCalls: string[]
  failureReason: string | null
  latencyMs: DurationMs
  costUsd: UsdAmount
  traceUrl: string | null
}

// ---------------------------------------------------------------------------
// Live runs (production traffic)
// ---------------------------------------------------------------------------

export type AgentRunStatus = 'completed' | 'failed' | 'blocked' | 'needs-confirmation' | 'running'

/**
 * `agent_runs.user_label` marking a row written by the TEST RUNNER, one per
 * test case, rather than by an operator (AIGENT-RUNNER-RUNTIME-029: the test
 * runner drives the same `executeCopilotRun` engine on the direct path).
 *
 * It lives here, in the shared vocabulary, because the producer
 * (`test-runner.ts`) and the readers that treat `agent_runs` as OPERATIONAL
 * truth (`agent-health.ts`, `available-agents.ts`) must agree on the exact
 * string — importing the test runner into a health read would drag an
 * execution engine into a metrics query. A graded test failure is the suite
 * working, not a production incident, so those readers filter it out.
 */
export const TEST_CASE_RUN_LABEL = 'test-case'

/**
 * Same idea, one per BENCHMARK TASK (AIGENT-BENCH-RUNTIME-030: the benchmark
 * runner drives that same engine on the direct path). Kept distinct from
 * `TEST_CASE_RUN_LABEL` because the two are different evaluations and an
 * operator reading `agent_runs` should be able to tell which one wrote a row.
 *
 * A benchmark task deliberately probes for unsafe behaviour, so counting one as
 * production traffic would be worse than counting a test case: the evaluation
 * would inflate the very error rate it exists to measure.
 */
export const BENCHMARK_TASK_RUN_LABEL = 'benchmark-task'

/**
 * Every `user_label` that marks an EVALUATION run rather than operator traffic.
 *
 * The readers that treat `agent_runs` as operational truth exclude this whole
 * set, so adding a future evaluation label here is the single edit that keeps
 * the health surfaces honest — a per-label `neq` filter would silently start
 * counting the next one.
 */
export const EVALUATION_RUN_LABELS = [TEST_CASE_RUN_LABEL, BENCHMARK_TASK_RUN_LABEL] as const

/**
 * The same set as a PostgREST filter fragment (`user_label=not.in.(...)`).
 * Built from the list above so a label can never be excluded from one health
 * read and forgotten in the other.
 */
export const NON_EVALUATION_RUN_FILTER = `user_label=not.in.(${EVALUATION_RUN_LABELS.join(',')})`

export interface AgentRun {
  id: string
  copilotId: string
  versionId: string
  projectId: string
  userLabel: string
  startedAt: IsoTimestamp
  finishedAt: IsoTimestamp | null
  status: AgentRunStatus
  stepIds: string[]
  inputSummary: string
  outputSummary: string
  toolCallCount: number
  unsafeAttemptCount: number
  latencyMs: DurationMs
  /** Null when the run's cost was not measurable (e.g. LangGraph with no usage). */
  costUsd: UsdAmount | null
  /**
   * Model actually RESOLVED at run time by the runner (`resolvedModel`), which
   * may differ from the copilot's DECLARED `model`. `null`/`undefined` = the run
   * predates the `agent_runs.resolved_model` column (old row) or the runner
   * never proved it — surfaced as "unverified" in the UI, never guessed.
   * Optional so pre-migration rows and seed fixtures need not carry it; the data
   * layer normalises reads to `null` and `modelUnverified: true` when absent.
   */
  resolvedModel?: string | null
  /** Provider actually resolved at run time. `null`/`undefined` → unverified. */
  resolvedProvider?: string | null
  /**
   * Whether the resolved model above is UNVERIFIED. Defaults to `true` at the
   * DB level (a run is presumed unverified until a writer proves it), so an old
   * row missing the column reads as unverified — absence of proof is surfaced,
   * never silently trusted. Absent (`undefined`) is treated as unverified too.
   */
  modelUnverified?: boolean
  /** LangSmith trace deep-link (placeholder in V1). */
  traceUrl: string | null
}

export type AgentRunStepKind =
  | 'llm-call'
  | 'tool-call'
  | 'memory-read'
  | 'memory-write'
  | 'guardrail-check'
  | 'confirmation'
  | 'output'

export interface AgentRunStep {
  id: string
  runId: string
  index: number
  kind: AgentRunStepKind
  title: string
  detail: string
  status: 'ok' | 'warning' | 'blocked' | 'error'
  startedAt: IsoTimestamp
  durationMs: DurationMs
  toolCallId: string | null
}

export interface ToolCall {
  id: string
  runId: string
  toolId: string
  toolName: string
  argumentsSummary: string
  resultSummary: string
  status: 'ok' | 'error' | 'blocked' | 'confirmed' | 'rejected'
  riskLevel: ToolRiskLevel
  requiredConfirmation: boolean
  latencyMs: DurationMs
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

export interface BenchmarkSuite {
  id: string
  copilotId: string
  name: string
  description: string
  taskCount: number
  dimensions: string[]
}

export interface BenchmarkRun {
  id: string
  suiteId: string
  copilotId: string
  /** Candidate under test. */
  versionId: string
  model: string
  modelProvider: ModelProvider
  runtime: AgentRuntime
  startedAt: IsoTimestamp
  finishedAt: IsoTimestamp | null
  status: 'queued' | 'running' | 'completed' | 'aborted'
  resultId: string | null
}

export interface BenchmarkResult {
  id: string
  runId: string
  accuracy: number // 0..1
  taskSuccessRate: number // 0..1
  avgLatencyMs: DurationMs
  p95LatencyMs: DurationMs
  avgCostPerTaskUsd: UsdAmount
  totalCostUsd: UsdAmount
  unsafeActionCount: number
  unauthorizedRouteCount: number
  confirmationMistakeCount: number
  /** Composite 0..100 used for ranking candidates. */
  score: number
}

// ---------------------------------------------------------------------------
// Replay lab
// ---------------------------------------------------------------------------

export interface ReplayComparison {
  id: string
  copilotId: string
  /** Historical production run being replayed. */
  sourceRunId: string
  createdAt: IsoTimestamp
  status: 'draft' | 'ready' | 'diverged' | 'matched'
  candidates: ReplayCandidate[]
  caseCount: number
}

export interface ReplayCandidate {
  id: string
  comparisonId: string
  versionId: string
  model: string
  modelProvider: ModelProvider
  outcome: 'matched' | 'improved' | 'diverged' | 'unsafe' | 'pending'
  matchRate: number | null // 0..1, null while pending
  notes: string
  steps: ReplayStepDiff[]
}

export interface ReplayStepDiff {
  stepIndex: number
  expected: string
  actual: string
  verdict: 'match' | 'acceptable-diff' | 'divergence' | 'unsafe'
}

// ---------------------------------------------------------------------------
// Shadow mode
// ---------------------------------------------------------------------------

export interface ShadowExperiment {
  id: string
  copilotId: string
  name: string
  productionVersionId: string
  candidateVersionId: string
  startedAt: IsoTimestamp
  endsAt: IsoTimestamp | null
  status: 'running' | 'completed' | 'stopped'
  sampledRunCount: number
  agreementRate: number // 0..1
  /** Threshold required by the promotion gate. */
  agreementThreshold: number // 0..1
  mismatches: ShadowMismatch[]
  unsafeProposalCount: number
}

export interface ShadowMismatch {
  id: string
  experimentId: string
  runId: string
  summary: string
  severity: 'info' | 'warning' | 'unsafe'
  productionAction: string
  candidateAction: string
  occurredAt: IsoTimestamp
}

// ---------------------------------------------------------------------------
// Promotion gate
// ---------------------------------------------------------------------------

export type PromotionCheckId =
  | 'test-pass-rate'
  | 'unsafe-actions'
  | 'unauthorized-routes'
  | 'confirmation-mistakes'
  | 'shadow-agreement'
  | 'human-approval'

export interface PromotionCheck {
  id: PromotionCheckId
  label: string
  description: string
  status: 'pass' | 'fail' | 'pending' | 'waived'
  /** Human-readable observed vs required, e.g. "98.2% ≥ 95%". */
  observed: string
  required: string
}

export interface PromotionGate {
  id: string
  copilotId: string
  candidateVersionId: string
  targetStage: Extract<VersionStage, 'production' | 'beta'>
  checks: PromotionCheck[]
  overallStatus: 'ready' | 'blocked' | 'pending-approval'
  approver: string | null
  approvedAt: IsoTimestamp | null
  lastEvaluatedAt: IsoTimestamp
}

// ---------------------------------------------------------------------------
// Cross-cutting UI aggregates
// ---------------------------------------------------------------------------

export interface RegistryWarning {
  id: string
  copilotId: string
  severity: 'warning' | 'danger'
  message: string
  occurredAt: IsoTimestamp
  href: string
}

/**
 * The single non-neutral accent the repo allows (green #A7FB90) plus the
 * neutral `zinc` ramp. No agent may pick any other colour — the dashboard is
 * mono-accent (check:catalyst / check:ds). A closed union so a wrong value
 * fails to typecheck rather than slipping a stray hue into the UI later.
 *
 * Lives here, not in a roster: every gamme (market, dropship, …)
 * carries it, and the doctrine must have exactly one definition.
 */
export type AgentAccent = 'accent' | 'zinc'
