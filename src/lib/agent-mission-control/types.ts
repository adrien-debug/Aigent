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
  platform: 'web' | 'desktop' | 'mobile' | 'api'
  createdAt: IsoTimestamp
}

export type AgentRuntime =
  | 'langgraph'
  | 'openai-assistants'
  | 'anthropic-sdk'
  | 'gemini'
  | 'custom'

export type CopilotStatus = 'active' | 'paused' | 'draft' | 'degraded' | 'archived'

export type ModelProvider = 'openai' | 'anthropic' | 'google' | 'mistral' | 'local'

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
}

export interface CopilotHealth {
  testPassRate: number // 0..1
  benchmarkScore: number // 0..100
  runsLast24h: number
  errorRateLast24h: number // 0..1
  avgLatencyMs: DurationMs
  costLast24hUsd: UsdAmount
  openWarnings: number
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
    unsafeActionCount: number
  }
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
  toolIds: string[]
  maxStepsPerRun: number
  maxCostPerRunUsd: UsdAmount
  updatedAt: IsoTimestamp
}

export interface MemorySource {
  id: string
  name: string
  kind: 'vector-store' | 'sql' | 'document' | 'session' | 'api'
  scope: 'user' | 'project' | 'global'
  readOnly: boolean
}

export interface OutputContract {
  format: 'json' | 'markdown' | 'text' | 'ui-actions'
  schemaName: string | null
  /** Human-readable invariants, e.g. "never returns raw SQL". */
  invariants: string[]
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
  costUsd: UsdAmount
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
