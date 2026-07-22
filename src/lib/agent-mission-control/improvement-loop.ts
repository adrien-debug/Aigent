/**
 * Agent Mission Control — Improvement Loop (server only).
 *
 * The loop that turns REAL execution signals into a better copilot version:
 *
 *   collect (tests + benchmarks + runs + LangGraph threads + LangSmith traces)
 *   → propose (a real gpt-5.4 completion root-causes the failures and emits a
 *     STRICT-JSON manifest patch — never free-form, never fabricated)
 *   → materialize V2 (new `manifests` + `copilot_versions` draft rows, assistant
 *     re-provisioned so the LangGraph runtime actually RUNS the V2 behaviour)
 *   → re-run (the EXISTING test/benchmark runners, pinned to the V2 versionId)
 *   → compare (latest completed runs per version, recomputed live — never
 *     persisted, so the numbers can't drift from test_runs/benchmark_runs)
 *   → human decision (approve/reject persisted on the proposal row; the actual
 *     production promotion stays behind the existing promotion route/UI).
 *
 * LIVE ONLY, fail-closed on the spine (DB, LLM), fail-soft on the observability
 * edges (LangGraph thread detail, LangSmith read) — a down tracing backend must
 * degrade the ANALYSIS INPUT, not break the loop; whatever was unavailable is
 * recorded honestly in `sources` and shown in the UI.
 *
 * The proposal may ONLY touch the behaviour fields the assistant config is
 * derived from (copilot-behavior.ts): systemPromptSummary, forbiddenActions,
 * alwaysConfirmActions, confirmationPolicy, maxStepsPerRun, output-contract
 * invariants. Tools are read-only by doctrine and NEVER added/removed here;
 * confirmationPolicy can only tighten. Everything else is server-validated —
 * the LLM's output is treated as untrusted input.
 *
 * Never import from a client component (reads the service-role key).
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

import { summarize } from './format'
import {
  hasBenchmarkBelowImproveTarget,
  IMPROVEMENT_MIN_BENCHMARK_ACCURACY,
  IMPROVEMENT_MIN_BENCHMARK_SCORE,
} from './improvement-criteria'
import {
  diagnoseFailure,
  hasManifestFixableFailures,
  nextRecommendedAction,
  type FailureCategory,
  type FailureDiagnosis,
  type RecommendedFixType,
} from './improvement-diagnosis'
import { runBenchmarkSuite } from './benchmark-runner'
import { ensureCopilotAssistant } from './langgraph-assistants'
import { getThreadDetail } from './langgraph-explorer'
import { ARCHITECT_MODEL } from './llm-client'
import { routeCompletion } from './model-router'
import { pgrest } from './postgrest'
import { NotFoundError } from './runner-errors'
import { summarizeRuntimeTelemetry, type RuntimeTelemetrySummary } from './runtime-telemetry-store'
import { makeId, slugify } from './slug'
import { runTestSuite } from './test-runner'
import type { ConfirmationPolicy, IsoTimestamp } from './types'

type RawRow = Record<string, unknown>

const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`
const inList = (ids: string[]) => ids.map((id) => encodeURIComponent(id)).join(',')
const NOTHING_TO_IMPROVE_PREFIX = 'nothing to improve:'

function isNothingToImproveReason(message: string): boolean {
  return message.startsWith(NOTHING_TO_IMPROVE_PREFIX)
}

// ---------------------------------------------------------------------------
// Signal collection — everything the proposer is allowed to reason from.
// ---------------------------------------------------------------------------

export interface FailingCaseSignal {
  suiteName: string
  caseName: string
  caseId: string
  input: string
  expectedBehavior: string
  expectedToolCalls: string[]
  status: string
  actualBehavior: string
  actualToolCalls: string[]
  failureReason: string | null
}

export interface SuiteSignal {
  suiteId: string
  suiteName: string
  kind: string
  caseCount: number
  lastRun: { id: string; passRate: number; versionId: string; finishedAt: string | null } | null
  failures: FailingCaseSignal[]
}

export interface BenchmarkSignal {
  suiteId: string
  suiteName: string
  lastRun: {
    id: string
    versionId: string
    score: number
    accuracy: number
    taskSuccessRate: number
    unsafeActionCount: number
    confirmationMistakeCount: number
  } | null
}

export interface ImprovementSources {
  db: boolean
  langgraph: boolean
  langsmith: boolean
  /** True when the deployed-agent runtime telemetry summary was read successfully. */
  runtimeTelemetry: boolean
  /** Human-readable reason when an observability source is unavailable. */
  langgraphReason?: string
  langsmithReason?: string
  runtimeTelemetryReason?: string
}

export interface ImprovementSignals {
  copilot: { id: string; name: string; model: string; slug: string }
  baseVersion: { id: string; label: string; stage: string; manifestId: string }
  manifest: {
    systemPromptSummary: string
    forbiddenActions: string[]
    confirmationPolicy: ConfirmationPolicy
    alwaysConfirmActions: string[]
    outputContractInvariants: string[]
    maxStepsPerRun: number
  }
  suites: SuiteSignal[]
  benchmarks: BenchmarkSignal[]
  /** Names of the tools actually mounted on the copilot (tools table) — the
   *  diagnosis rules need them to split "tool missing" from "tool unused". */
  toolNames: string[]
  /** Recent real runs (DB mirror of LangGraph executions). */
  recentRuns: Array<{
    id: string
    status: string
    inputSummary: string
    outputSummary: string
    toolCallCount: number
    unsafeAttemptCount: number
    latencyMs: number
  }>
  /** Live LangGraph thread detail for the copilot's recent runs (sampled). */
  langgraphThreads: Array<{ threadId: string; status: string; currentNode: string | null; interruptCount: number }>
  /** LangSmith root runs of the tracing project (recent, compact). */
  langsmithRuns: Array<{ name: string; status: string; error: string | null; latencyMs: number | null }>
  /** Deployed-agent runtime telemetry summary (opt-in, best-effort pings from
   *  generated handlers) — absent when unavailable or no data exists yet. */
  runtimeTelemetry?: RuntimeTelemetrySummary
  sources: ImprovementSources
}

/**
 * Version under analysis: explicit (an open cycle's recorded base — after V2
 * creation `latest_version_id` already points at the V2, so "latest" would lie
 * about the base) → production → latest (mirrors the runners).
 */
async function resolveBaseVersion(
  copilotRow: RawRow,
  explicitVersionId?: string
): Promise<{ id: string; label: string; stage: string; manifestId: string }> {
  const versionId =
    explicitVersionId ??
    (copilotRow.production_version_id as string | null) ??
    (copilotRow.latest_version_id as string | null)
  if (!versionId) throw new NotFoundError('copilot has no production or latest version')
  const rows = await pgrest<RawRow[]>('GET', `copilot_versions?${eq('id', versionId)}&select=id,label,stage,manifest_id`)
  if (rows.length === 0) throw new NotFoundError(`version not found: ${versionId}`)
  const manifestId = rows[0].manifest_id as string | null
  if (!manifestId) throw new NotFoundError(`version ${versionId} has no manifest`)
  return { id: rows[0].id as string, label: (rows[0].label as string) ?? versionId, stage: (rows[0].stage as string) ?? 'draft', manifestId }
}

/**
 * Read recent root runs of the LangSmith tracing project (the project the
 * GPU1 Agent Server exports to). Dependency-free fetch against the documented
 * API: resolve the session id by name, then query its recent root runs.
 * Fail-soft: any missing key / HTTP / shape problem returns {available:false}.
 */
async function readLangSmithRuns(limit = 25): Promise<
  | { available: true; runs: ImprovementSignals['langsmithRuns'] }
  | { available: false; reason: string }
> {
  const apiKey = process.env.LANGSMITH_API_KEY
  if (!apiKey) return { available: false, reason: 'LANGSMITH_API_KEY not set' }
  const endpoint = (process.env.LANGSMITH_ENDPOINT || 'https://api.smith.langchain.com').replace(/\/$/, '')
  const project = process.env.LANGSMITH_PROJECT || 'agent_builder'
  const headers = { 'x-api-key': apiKey, 'content-type': 'application/json' }

  try {
    const sessionRes = await fetch(`${endpoint}/api/v1/sessions?name=${encodeURIComponent(project)}`, {
      headers,
      signal: AbortSignal.timeout(8000),
    })
    if (!sessionRes.ok) return { available: false, reason: `LangSmith sessions ${sessionRes.status}` }
    const sessions = (await sessionRes.json()) as Array<{ id?: string }>
    const sessionId = sessions[0]?.id
    if (!sessionId) return { available: false, reason: `LangSmith project "${project}" not found` }

    const queryRes = await fetch(`${endpoint}/api/v1/runs/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ session: [sessionId], is_root: true, limit, select: ['name', 'status', 'error', 'start_time', 'end_time'] }),
      signal: AbortSignal.timeout(8000),
    })
    if (!queryRes.ok) return { available: false, reason: `LangSmith runs/query ${queryRes.status}` }
    const payload = (await queryRes.json()) as { runs?: Array<Record<string, unknown>> }
    const runs = (payload.runs ?? []).map((r) => {
      const start = typeof r.start_time === 'string' ? Date.parse(r.start_time) : NaN
      const end = typeof r.end_time === 'string' ? Date.parse(r.end_time) : NaN
      return {
        name: typeof r.name === 'string' ? r.name : 'run',
        status: typeof r.status === 'string' ? r.status : 'unknown',
        error: typeof r.error === 'string' && r.error.length > 0 ? summarize(r.error, 200) : null,
        latencyMs: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null,
      }
    })
    return { available: true, runs }
  } catch (err) {
    return { available: false, reason: err instanceof Error ? summarize(err.message, 120) : 'network error' }
  }
}

/**
 * Collect every real signal the proposer reasons from. DB reads are the spine
 * (throw on failure); LangGraph thread detail and LangSmith reads are edges
 * (fail-soft, recorded in `sources`). Pass `includeObservability: false` for
 * display-only reads (the improve PAGE) — the DB summary renders without
 * paying two network round-trips per render; the ANALYSIS always includes them.
 */
export async function collectImprovementSignals(
  copilotId: string,
  opts: { includeObservability?: boolean; baseVersionId?: string } = {}
): Promise<ImprovementSignals> {
  const includeObservability = opts.includeObservability !== false
  const copilotRows = await pgrest<RawRow[]>('GET', `copilots?${eq('id', copilotId)}&select=*`)
  if (copilotRows.length === 0) throw new NotFoundError(`copilot not found: ${copilotId}`)
  const copilotRow = copilotRows[0]
  const baseVersion = await resolveBaseVersion(copilotRow, opts.baseVersionId)

  // The V1 manifest is the one the base version points at — not "latest by
  // updated_at" (a V2 draft may already exist from an earlier cycle).
  const manifestRows = await pgrest<RawRow[]>('GET', `manifests?${eq('id', baseVersion.manifestId)}&select=*`)
  if (manifestRows.length === 0) throw new NotFoundError(`manifest not found: ${baseVersion.manifestId}`)
  const m = manifestRows[0]
  const outputContract = (m.output_contract as { invariants?: string[] } | null) ?? {}

  // --- Tests: per suite, the latest completed run + the failing/error cases.
  // Batched: ONE request per table via `suite_id=in.(...)` / `run_id=in.(...)`
  // (agent-health.ts pattern) instead of 3 requests per suite, and the
  // previously-unbounded lists are bounded.
  const suiteRows = await pgrest<RawRow[]>('GET', `test_suites?${eq('copilot_id', copilotId)}&select=*&order=name&limit=100`)
  const suiteIds = suiteRows.map((s) => s.id as string)

  const caseRows = suiteIds.length
    ? await pgrest<RawRow[]>(
        'GET',
        `test_cases?suite_id=in.(${inList(suiteIds)})&select=id,suite_id,name,input,expected_behavior,expected_tool_calls`
      )
    : []
  const casesBySuite = new Map<string, RawRow[]>()
  for (const c of caseRows) {
    const sid = c.suite_id as string
    const bucket = casesBySuite.get(sid)
    if (bucket) bucket.push(c)
    else casesBySuite.set(sid, [c])
  }

  // Pinned to the BASE version: after a V2 re-run exists, "base signals"
  // must keep describing the version under analysis, not the newest run.
  // Newest-first ordering, first row per suite wins (a version's runs per
  // suite are few, so the bound never hides a suite's latest run in practice).
  const testRunRows = suiteIds.length
    ? await pgrest<RawRow[]>(
        'GET',
        `test_runs?suite_id=in.(${inList(suiteIds)})&${eq('version_id', baseVersion.id)}&status=eq.completed&select=id,suite_id,pass_rate,version_id,finished_at&order=started_at.desc&limit=500`
      )
    : []
  const lastRunBySuite = new Map<string, RawRow>()
  for (const r of testRunRows) {
    const sid = r.suite_id as string
    if (!lastRunBySuite.has(sid)) lastRunBySuite.set(sid, r) // newest-first → first seen wins
  }

  const lastRunIds = [...lastRunBySuite.values()].map((r) => r.id as string)
  const resultRows = lastRunIds.length
    ? await pgrest<RawRow[]>('GET', `test_results?run_id=in.(${inList(lastRunIds)})&status=in.(fail,error)&select=*`)
    : []
  const failResultsByRun = new Map<string, RawRow[]>()
  for (const r of resultRows) {
    const rid = r.run_id as string
    const bucket = failResultsByRun.get(rid)
    if (bucket) bucket.push(r)
    else failResultsByRun.set(rid, [r])
  }

  const suites: SuiteSignal[] = []
  for (const s of suiteRows) {
    const suiteId = s.id as string
    const suiteCases = casesBySuite.get(suiteId) ?? []
    const caseById = new Map(suiteCases.map((c) => [c.id as string, c]))
    const lastRunRow = lastRunBySuite.get(suiteId)
    const failures: FailingCaseSignal[] = []
    if (lastRunRow) {
      for (const r of failResultsByRun.get(lastRunRow.id as string) ?? []) {
        const c = caseById.get(r.case_id as string)
        failures.push({
          suiteName: (s.name as string) ?? suiteId,
          caseName: (c?.name as string) ?? (r.case_id as string),
          caseId: r.case_id as string,
          input: (c?.input as string) ?? '',
          expectedBehavior: (c?.expected_behavior as string) ?? '',
          expectedToolCalls: (c?.expected_tool_calls as string[]) ?? [],
          status: r.status as string,
          actualBehavior: (r.actual_behavior as string) ?? '',
          actualToolCalls: (r.actual_tool_calls as string[]) ?? [],
          failureReason: (r.failure_reason as string | null) ?? null,
        })
      }
    }
    suites.push({
      suiteId,
      suiteName: (s.name as string) ?? suiteId,
      kind: (s.kind as string) ?? 'behavior',
      caseCount: suiteCases.length,
      lastRun: lastRunRow
        ? {
            id: lastRunRow.id as string,
            passRate: (lastRunRow.pass_rate as number) ?? 0,
            versionId: (lastRunRow.version_id as string) ?? '',
            finishedAt: (lastRunRow.finished_at as string | null) ?? null,
          }
        : null,
      failures,
    })
  }

  // --- Mounted tools (names) — feeds the deterministic diagnosis rules.
  const toolRows = await pgrest<RawRow[]>('GET', `tools?${eq('copilot_id', copilotId)}&select=name&order=name&limit=200`)
  const toolNames = toolRows.map((t) => t.name as string)

  // --- Benchmarks: per suite, the latest completed run + its result.
  // Same batching: one request per table instead of 2 per suite.
  const benchSuiteRows = await pgrest<RawRow[]>('GET', `benchmark_suites?${eq('copilot_id', copilotId)}&select=id,name&order=name&limit=100`)
  const benchSuiteIds = benchSuiteRows.map((b) => b.id as string)
  const benchRunRows = benchSuiteIds.length
    ? await pgrest<RawRow[]>(
        'GET',
        `benchmark_runs?suite_id=in.(${inList(benchSuiteIds)})&${eq('version_id', baseVersion.id)}&status=eq.completed&select=id,suite_id,version_id&order=started_at.desc&limit=500`
      )
    : []
  const lastBenchRunBySuite = new Map<string, RawRow>()
  for (const r of benchRunRows) {
    const sid = r.suite_id as string
    if (!lastBenchRunBySuite.has(sid)) lastBenchRunBySuite.set(sid, r)
  }
  const benchRunIds = [...lastBenchRunBySuite.values()].map((r) => r.id as string)
  const benchResultRows = benchRunIds.length
    ? await pgrest<RawRow[]>('GET', `benchmark_results?run_id=in.(${inList(benchRunIds)})&select=*`)
    : []
  const benchResultByRun = new Map<string, RawRow>()
  for (const r of benchResultRows) {
    const rid = r.run_id as string
    if (!benchResultByRun.has(rid)) benchResultByRun.set(rid, r) // mirrors the old resultRows[0]
  }

  const benchmarks: BenchmarkSignal[] = benchSuiteRows.map((b) => {
    const runRow = lastBenchRunBySuite.get(b.id as string)
    const res = runRow ? benchResultByRun.get(runRow.id as string) : undefined
    const lastRun: BenchmarkSignal['lastRun'] =
      runRow && res
        ? {
            id: runRow.id as string,
            versionId: (runRow.version_id as string) ?? '',
            score: (res.score as number) ?? 0,
            accuracy: (res.accuracy as number) ?? 0,
            taskSuccessRate: (res.task_success_rate as number) ?? 0,
            unsafeActionCount: (res.unsafe_action_count as number) ?? 0,
            confirmationMistakeCount: (res.confirmation_mistake_count as number) ?? 0,
          }
        : null
    return { suiteId: b.id as string, suiteName: (b.name as string) ?? (b.id as string), lastRun }
  })

  // --- Recent real runs (DB) + their LangGraph threads (sampled, fail-soft).
  const runRows = await pgrest<RawRow[]>(
    'GET',
    `agent_runs?${eq('copilot_id', copilotId)}&select=id,status,input_summary,output_summary,tool_call_count,unsafe_attempt_count,latency_ms,thread_id&order=started_at.desc&limit=15`
  )
  const recentRuns = runRows.map((r) => ({
    id: r.id as string,
    status: (r.status as string) ?? 'completed',
    inputSummary: (r.input_summary as string) ?? '',
    outputSummary: (r.output_summary as string) ?? '',
    toolCallCount: (r.tool_call_count as number) ?? 0,
    unsafeAttemptCount: (r.unsafe_attempt_count as number) ?? 0,
    latencyMs: (r.latency_ms as number) ?? 0,
  }))

  const langgraphThreads: ImprovementSignals['langgraphThreads'] = []
  let langgraphReason: string | undefined
  let langsmith: Awaited<ReturnType<typeof readLangSmithRuns>> = {
    available: false,
    reason: 'skipped (display-only read)',
  }
  let runtimeTelemetry: RuntimeTelemetrySummary | undefined
  let runtimeTelemetryAvailable = false
  let runtimeTelemetryReason: string | undefined
  if (includeObservability) {
    const threadIds = Array.from(
      new Set(runRows.map((r) => r.thread_id as string | null).filter((t): t is string => typeof t === 'string' && t.length > 0))
    ).slice(0, 3)
    for (const threadId of threadIds) {
      try {
        const detail = await getThreadDetail(threadId)
        if (detail) {
          langgraphThreads.push({
            threadId,
            status: detail.status,
            currentNode: detail.currentNode ?? null,
            interruptCount: detail.interrupts.length,
          })
        }
      } catch (err) {
        langgraphReason = err instanceof Error ? summarize(err.message, 120) : 'Agent Server unreachable'
      }
    }
    if (threadIds.length === 0) langgraphReason = 'no recent runs carry a LangGraph thread id'
    langsmith = await readLangSmithRuns()

    // Runtime telemetry — same fail-soft edge as LangGraph/LangSmith above:
    // a down/empty telemetry store must degrade the ANALYSIS INPUT, never
    // break signal collection.
    try {
      const projectId = (copilotRow.project_id as string | null) ?? null
      if (!projectId) {
        runtimeTelemetryReason = 'copilot has no project_id'
      } else {
        runtimeTelemetry = await summarizeRuntimeTelemetry(projectId, copilotId)
        runtimeTelemetryAvailable = true
      }
    } catch (err) {
      runtimeTelemetryReason = err instanceof Error ? summarize(err.message, 120) : 'runtime telemetry unavailable'
    }
  } else {
    langgraphReason = 'skipped (display-only read)'
    runtimeTelemetryReason = 'skipped (display-only read)'
  }

  return {
    copilot: {
      id: copilotRow.id as string,
      name: (copilotRow.name as string) ?? copilotId,
      model: (copilotRow.model as string) ?? ARCHITECT_MODEL,
      slug: (copilotRow.slug as string) ?? slugify((copilotRow.name as string) ?? copilotId),
    },
    baseVersion,
    manifest: {
      systemPromptSummary: (m.system_prompt_summary as string) ?? '',
      forbiddenActions: (m.forbidden_actions as string[]) ?? [],
      confirmationPolicy: ((m.confirmation_policy as ConfirmationPolicy) ?? 'risky-only') as ConfirmationPolicy,
      alwaysConfirmActions: (m.always_confirm_actions as string[]) ?? [],
      outputContractInvariants: outputContract.invariants ?? [],
      maxStepsPerRun: (m.max_steps_per_run as number) ?? 12,
    },
    suites,
    benchmarks,
    toolNames,
    recentRuns,
    langgraphThreads,
    langsmithRuns: langsmith.available ? langsmith.runs : [],
    ...(runtimeTelemetry ? { runtimeTelemetry } : {}),
    sources: {
      db: true,
      langgraph: langgraphThreads.length > 0,
      langsmith: langsmith.available,
      runtimeTelemetry: runtimeTelemetryAvailable,
      ...(langgraphThreads.length === 0 && langgraphReason ? { langgraphReason } : {}),
      ...(!langsmith.available ? { langsmithReason: langsmith.reason } : {}),
      ...(!runtimeTelemetryAvailable && runtimeTelemetryReason ? { runtimeTelemetryReason } : {}),
    },
  }
}

// ---------------------------------------------------------------------------
// Proposal generation — a real completion, STRICT JSON, server-validated.
// ---------------------------------------------------------------------------

/** One behaviour field change: before → after, with the model's rationale. */
export interface ManifestFieldChange<T> {
  from: T
  to: T
  why: string
}

export interface ImprovementManifestChanges {
  systemPromptSummary?: ManifestFieldChange<string>
  forbiddenActions?: ManifestFieldChange<string[]>
  alwaysConfirmActions?: ManifestFieldChange<string[]>
  confirmationPolicy?: ManifestFieldChange<ConfirmationPolicy>
  maxStepsPerRun?: ManifestFieldChange<number>
  outputContractInvariants?: ManifestFieldChange<string[]>
}

export interface FailureAnalysisEntry {
  caseName: string
  rootCause: string
  evidence: string
  /** Deterministic classification (improvement-diagnosis.ts) — absent on
   *  proposals persisted before the diagnosis engine existed. */
  caseId?: string
  category?: FailureCategory
  confidence?: number
  recommendedFixType?: RecommendedFixType
}

/**
 * Deterministic diagnoses for every failing case in the collected signals —
 * pure and cheap, so the improve PAGE recomputes them live on each render
 * (they always describe the CURRENT failures, even for cycles persisted
 * before the engine existed).
 */
export function diagnoseSignals(signals: ImprovementSignals): FailureDiagnosis[] {
  return signals.suites.flatMap((s) =>
    s.failures.map((f) =>
      diagnoseFailure(
        {
          caseId: f.caseId,
          status: f.status,
          failureReason: f.failureReason,
          actualBehavior: f.actualBehavior,
          expectedBehavior: f.expectedBehavior,
          expectedToolCalls: f.expectedToolCalls,
          actualToolCalls: f.actualToolCalls,
        },
        signals.toolNames
      )
    )
  )
}

export interface ImprovementProposal {
  id: string
  copilotId: string
  baseVersionId: string
  v2VersionId: string | null
  v2ManifestId: string | null
  status: 'proposed' | 'v2-created' | 'approved' | 'rejected'
  summary: string
  failureAnalysis: FailureAnalysisEntry[]
  manifestChanges: ImprovementManifestChanges
  sources: ImprovementSources
  costUsd: number
  createdAt: IsoTimestamp
  createdBy: string
  decidedBy: string | null
  decidedAt: IsoTimestamp | null
}

const PROPOSER_SYSTEM =
  'You are the improvement architect for an AI copilot running on a LangGraph agent server. You receive ' +
  'REAL execution signals as JSON: the current behaviour manifest, per-suite test results with each ' +
  'failing case (input, expected behaviour, expected tool calls, actual reply, actual tool calls, failure ' +
  'reason), benchmark scores, recent run summaries, LangGraph thread states and LangSmith trace statuses. ' +
  'Root-cause each failure FROM THE EVIDENCE (quote the failure_reason / actual behaviour), then propose a ' +
  'V2 of the behaviour manifest. You may ONLY change these fields: systemPromptSummary (the copilot\'s ' +
  'behaviour charter: rewrite it to directly address the observed failure modes — name the expected tool ' +
  'usage, the confirmation discipline, the output shape), forbiddenActions (string[]), alwaysConfirmActions ' +
  '(string[]), confirmationPolicy, maxStepsPerRun (integer 1..24), outputContractInvariants (string[]). ' +
  'HARD CONSTRAINTS: tools are read-only and MUST NOT be added, removed or renamed; confirmationPolicy may ' +
  'only stay equal or get STRICTER (never → risky-only → always); never weaken safety rules; keep every ' +
  'change grounded in an observed failure — no speculative rewrites of things that pass. The user payload ' +
  'also carries `deterministicDiagnoses` (rule-based, AUTHORITATIVE): a case categorized `graph_recursion` ' +
  'or `runtime_limit` CANNOT be fixed by manifest changes — never claim your manifest changes fix it; state ' +
  'in the summary that it needs a runtime/graph stop-condition patch, and aim manifestChanges at the OTHER ' +
  'failures. Return STRICT ' +
  'JSON, no prose outside it, with keys: summary (2-3 sentences, what changes and why), failureAnalysis ' +
  '(array of {caseName, rootCause, evidence}), manifestChanges (object whose keys are ONLY the fields you ' +
  'change, each value {from, to, why}), expectedImpact (1 sentence).'

const POLICY_ORDER: Record<ConfirmationPolicy, number> = { never: 0, 'risky-only': 1, always: 2 }

function asStringArray(v: unknown, maxItems = 24, maxLen = 300): string[] | null {
  if (!Array.isArray(v)) return null
  const out = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => summarize(x, maxLen))
  return out.slice(0, maxItems)
}

/**
 * Server-side validation of the model's manifestChanges — the LLM output is
 * UNTRUSTED input. Unknown fields are dropped; each kept change is re-based on
 * the REAL V1 value (`from` is overwritten with the manifest's actual value so
 * the UI diff never lies); invalid values drop the field. Returns null when
 * nothing valid survives (the caller fails the analysis honestly).
 */
function validateManifestChanges(
  raw: unknown,
  manifest: ImprovementSignals['manifest']
): ImprovementManifestChanges | null {
  if (typeof raw !== 'object' || raw === null) return null
  const input = raw as Record<string, { from?: unknown; to?: unknown; why?: unknown }>
  const out: ImprovementManifestChanges = {}
  const why = (v: { why?: unknown }): string => (typeof v.why === 'string' ? summarize(v.why, 400) : '')

  const sp = input.systemPromptSummary
  if (sp && typeof sp.to === 'string' && sp.to.trim().length >= 20) {
    const to = sp.to.trim().slice(0, 4000)
    if (to !== manifest.systemPromptSummary) {
      out.systemPromptSummary = { from: manifest.systemPromptSummary, to, why: why(sp) }
    }
  }

  const fa = input.forbiddenActions
  if (fa) {
    const to = asStringArray(fa.to)
    if (to && to.length > 0 && JSON.stringify(to) !== JSON.stringify(manifest.forbiddenActions)) {
      out.forbiddenActions = { from: manifest.forbiddenActions, to, why: why(fa) }
    }
  }

  const aca = input.alwaysConfirmActions
  if (aca) {
    const to = asStringArray(aca.to)
    if (to && JSON.stringify(to) !== JSON.stringify(manifest.alwaysConfirmActions)) {
      out.alwaysConfirmActions = { from: manifest.alwaysConfirmActions, to, why: why(aca) }
    }
  }

  const cp = input.confirmationPolicy
  if (cp && (cp.to === 'never' || cp.to === 'risky-only' || cp.to === 'always')) {
    const to = cp.to as ConfirmationPolicy
    // Only equal-or-stricter survives; equal is a no-op so only stricter is kept.
    if (POLICY_ORDER[to] > POLICY_ORDER[manifest.confirmationPolicy]) {
      out.confirmationPolicy = { from: manifest.confirmationPolicy, to, why: why(cp) }
    }
  }

  const ms = input.maxStepsPerRun
  if (ms && typeof ms.to === 'number' && Number.isInteger(ms.to) && ms.to >= 1 && ms.to <= 24 && ms.to !== manifest.maxStepsPerRun) {
    out.maxStepsPerRun = { from: manifest.maxStepsPerRun, to: ms.to, why: why(ms) }
  }

  const inv = input.outputContractInvariants
  if (inv) {
    const to = asStringArray(inv.to)
    if (to && JSON.stringify(to) !== JSON.stringify(manifest.outputContractInvariants)) {
      out.outputContractInvariants = { from: manifest.outputContractInvariants, to, why: why(inv) }
    }
  }

  return Object.keys(out).length > 0 ? out : null
}

function parseFailureAnalysis(raw: unknown): FailureAnalysisEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .map((e) => ({
      caseName: typeof e.caseName === 'string' ? summarize(e.caseName, 160) : 'unnamed case',
      rootCause: typeof e.rootCause === 'string' ? summarize(e.rootCause, 500) : '',
      evidence: typeof e.evidence === 'string' ? summarize(e.evidence, 500) : '',
    }))
    .filter((e) => e.rootCause.length > 0)
    .slice(0, 12)
}

/**
 * Run the analysis: collect signals, ask the architect model for a STRICT-JSON
 * proposal, validate it server-side, persist an `improvement_proposals` row.
 * Throws on LLM/parse/validation failure — an unusable proposal is an error,
 * never a silently-empty "improvement".
 */
export async function analyzeAndPropose(copilotId: string, triggeredBy: string): Promise<{ proposal: ImprovementProposal; signals: ImprovementSignals }> {
  const signals = await collectImprovementSignals(copilotId)

  const totalFailures = signals.suites.reduce((n, s) => n + s.failures.length, 0)
  const hasWeakBenchmark = hasBenchmarkBelowImproveTarget(signals.benchmarks)
  if (totalFailures === 0 && !hasWeakBenchmark) {
    throw new NotFoundError(
      `${NOTHING_TO_IMPROVE_PREFIX} no failing test case and no benchmark below target (score >= ${IMPROVEMENT_MIN_BENCHMARK_SCORE}, accuracy >= ${Math.round(IMPROVEMENT_MIN_BENCHMARK_ACCURACY * 100)}%)`
    )
  }

  // Deterministic diagnoses FIRST — rule hits are authoritative over whatever
  // narrative the LLM produces for the same case (see improvement-diagnosis.ts).
  const diagnoses = diagnoseSignals(signals)

  // When every failing case is a non-manifest blocker (graph recursion, missing
  // tool, judge noise, …), do NOT call the proposer or persist a bogus manifest
  // patch — that is the Security Sentinel regression this guard closes.
  if (diagnoses.length > 0 && !hasManifestFixableFailures(diagnoses)) {
    const action = nextRecommendedAction(diagnoses)
    throw new NotFoundError(
      action?.headline ?? 'remaining failures are not fixable via a manifest patch'
    )
  }

  const res = await routeCompletion({
    purpose: 'architect',
    modelProvider: 'openai',
    model: ARCHITECT_MODEL,
    messages: [
      { role: 'system', content: PROPOSER_SYSTEM },
      { role: 'user', content: JSON.stringify({ ...signals, deterministicDiagnoses: diagnoses }) },
    ],
    responseFormat: 'json',
    maxOutputTokens: 3072,
  })

  let parsed: Record<string, unknown>
  try {
    const cleaned = res.text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    parsed = JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    throw new Error('improvement proposer returned unparseable output')
  }

  const manifestChanges = validateManifestChanges(parsed.manifestChanges, signals.manifest)
  if (!manifestChanges) {
    throw new NotFoundError('improvement proposer returned no valid manifest change')
  }
  const summaryText = typeof parsed.summary === 'string' ? summarize(parsed.summary, 800) : ''
  const expectedImpact = typeof parsed.expectedImpact === 'string' ? summarize(parsed.expectedImpact, 300) : ''
  const summary = [summaryText, expectedImpact].filter(Boolean).join(' — ')
  if (!summary) throw new Error('improvement proposer returned no summary')

  // Merge: one entry per REAL failing case, LLM narrative when it addressed
  // the case, deterministic category/fix stamped on top (the rules win).
  const llmEntries = parseFailureAnalysis(parsed.failureAnalysis)
  const failures = signals.suites.flatMap((s) => s.failures)
  const failureAnalysis: FailureAnalysisEntry[] = failures.map((f) => {
    const d = diagnoses.find((x) => x.testCaseId === f.caseId)
    const llm = llmEntries.find((e) => e.caseName === f.caseName)
    return {
      caseName: f.caseName,
      caseId: f.caseId,
      rootCause: llm?.rootCause ?? (d ? `rule-classified: ${d.category}` : 'unclassified'),
      evidence: llm?.evidence || (d?.evidence.join(' | ') ?? ''),
      ...(d ? { category: d.category, confidence: d.confidence, recommendedFixType: d.recommendedFixType } : {}),
    }
  })

  const proposal: ImprovementProposal = {
    id: makeId('improve', `${signals.copilot.slug}-${randomUUID().slice(0, 8)}`),
    copilotId,
    baseVersionId: signals.baseVersion.id,
    v2VersionId: null,
    v2ManifestId: null,
    status: 'proposed',
    summary,
    failureAnalysis,
    manifestChanges,
    sources: signals.sources,
    costUsd: res.costUsd,
    createdAt: new Date().toISOString(),
    createdBy: triggeredBy,
    decidedBy: null,
    decidedAt: null,
  }

  await pgrest('POST', 'improvement_proposals', {
    id: proposal.id,
    copilot_id: proposal.copilotId,
    base_version_id: proposal.baseVersionId,
    status: proposal.status,
    summary: proposal.summary,
    failure_analysis: proposal.failureAnalysis,
    manifest_changes: proposal.manifestChanges,
    sources: proposal.sources,
    cost_usd: Math.round(proposal.costUsd * 1e6) / 1e6,
    created_at: proposal.createdAt,
    created_by: proposal.createdBy,
  })

  return { proposal, signals }
}

// ---------------------------------------------------------------------------
// V2 materialization — new manifest + version rows, assistant re-provisioned.
// ---------------------------------------------------------------------------

/** "v0.1.0-draft" → "v0.2.0-draft"; anything unparsable → "<label>-v2". */
function bumpLabel(baseLabel: string): string {
  const match = baseLabel.match(/^v(\d+)\.(\d+)\.(\d+)/)
  if (!match) return `${baseLabel}-v2`
  return `v${match[1]}.${Number(match[2]) + 1}.0-draft`
}

/**
 * Materialize a proposed improvement into a real V2 draft:
 *   1. copy the V1 manifest row, apply the validated changes, insert as V2
 *   2. insert a draft `copilot_versions` row pointing at it
 *   3. move `copilots.latest_version_id` to the V2
 *   4. re-provision the copilot's assistant (its config derives from the
 *      LATEST manifest, so this is what makes V2 the RUNNING behaviour)
 *   5. stamp the proposal `v2-created`
 * Fail-closed and non-atomic (PostgREST has no cross-table transaction):
 * a failure mid-way surfaces loudly; earlier rows stay for operator cleanup.
 */
export async function createImprovementV2(copilotId: string, proposalId: string): Promise<{ v2VersionId: string; v2ManifestId: string; label: string }> {
  const proposalRows = await pgrest<RawRow[]>('GET', `improvement_proposals?${eq('id', proposalId)}&select=*`)
  if (proposalRows.length === 0) throw new NotFoundError(`proposal not found: ${proposalId}`)
  const proposal = proposalRows[0]
  if ((proposal.copilot_id as string) !== copilotId) {
    throw new NotFoundError(`proposal ${proposalId} does not belong to copilot ${copilotId}`)
  }
  // Fast path only — the AUTHORITATIVE status gate is the atomic claim below
  // (a plain read-then-check races a concurrent call on the same proposal).
  if ((proposal.status as string) !== 'proposed') {
    throw new Error(`proposal is ${proposal.status as string}, expected 'proposed'`)
  }

  const copilotRows = await pgrest<RawRow[]>('GET', `copilots?${eq('id', copilotId)}&select=*`)
  if (copilotRows.length === 0) throw new NotFoundError(`copilot not found: ${copilotId}`)
  const copilotRow = copilotRows[0]

  const baseVersionId = proposal.base_version_id as string
  const baseVersionRows = await pgrest<RawRow[]>('GET', `copilot_versions?${eq('id', baseVersionId)}&select=*`)
  if (baseVersionRows.length === 0) throw new NotFoundError(`base version not found: ${baseVersionId}`)
  const baseVersion = baseVersionRows[0]

  const baseManifestRows = await pgrest<RawRow[]>('GET', `manifests?${eq('id', baseVersion.manifest_id as string)}&select=*`)
  if (baseManifestRows.length === 0) throw new NotFoundError(`manifest not found: ${baseVersion.manifest_id as string}`)
  const baseManifest = baseManifestRows[0]

  const changes = (proposal.manifest_changes as ImprovementManifestChanges) ?? {}
  const now = new Date().toISOString()
  const slug = (copilotRow.slug as string) ?? slugify((copilotRow.name as string) ?? copilotId)
  const suffix = randomUUID().slice(0, 8)
  const v2ManifestId = makeId('manifest', `${slug}-v2-${suffix}`)
  const v2VersionId = makeId('version', `${slug}-v2-${suffix}`)
  const label = bumpLabel((baseVersion.label as string) ?? 'v0.1.0-draft')

  // 0. ATOMIC CLAIM — the conditional PATCH (`status=eq.proposed`) is the real
  //    concurrency gate: two concurrent calls both pass the read above, but
  //    PostgREST updates the row for exactly ONE of them; the loser gets zero
  //    rows back and fails with the same classifiable message as the fast path
  //    (the create-v2 route maps it to 409). The V2 ids are stamped in step 5,
  //    AFTER the rows they reference exist.
  const claimed = await pgrest<RawRow[]>(
    'PATCH',
    `improvement_proposals?${eq('id', proposalId)}&status=eq.proposed`,
    { status: 'v2-created' }
  )
  if (claimed.length === 0) {
    const nowRows = await pgrest<RawRow[]>('GET', `improvement_proposals?${eq('id', proposalId)}&select=status`)
    if (nowRows.length === 0) throw new NotFoundError(`proposal not found: ${proposalId}`)
    throw new Error(`proposal is ${nowRows[0].status as string}, expected 'proposed'`)
  }

  try {
    // 1. V2 manifest = V1 columns + validated changes. output_contract keeps its
    //    V1 shape with only `invariants` swapped when proposed.
    const baseContract = (baseManifest.output_contract as Record<string, unknown> | null) ?? {}
    await pgrest('POST', 'manifests', {
      id: v2ManifestId,
      copilot_id: copilotId,
      version: label,
      system_prompt_summary: changes.systemPromptSummary?.to ?? (baseManifest.system_prompt_summary as string),
      allowed_routes: baseManifest.allowed_routes,
      forbidden_actions: changes.forbiddenActions?.to ?? baseManifest.forbidden_actions,
      confirmation_policy: changes.confirmationPolicy?.to ?? baseManifest.confirmation_policy,
      always_confirm_actions: changes.alwaysConfirmActions?.to ?? baseManifest.always_confirm_actions,
      memory_sources: baseManifest.memory_sources,
      output_contract: { ...baseContract, invariants: changes.outputContractInvariants?.to ?? baseContract.invariants ?? [] },
      // Skills are reported V1→V2 unchanged — the Improvement Loop never rewrites them.
      skills: baseManifest.skills ?? [],
      tool_ids: baseManifest.tool_ids,
      max_steps_per_run: changes.maxStepsPerRun?.to ?? baseManifest.max_steps_per_run,
      max_cost_per_run_usd: baseManifest.max_cost_per_run_usd,
      updated_at: now,
    })

    // 2. Draft V2 version.
    await pgrest('POST', 'copilot_versions', {
      id: v2VersionId,
      copilot_id: copilotId,
      label,
      stage: 'draft',
      manifest_id: v2ManifestId,
      model: copilotRow.model,
      model_provider: copilotRow.model_provider,
      changelog: summarize((proposal.summary as string) ?? 'Improvement Loop V2', 800),
      created_at: now,
      created_by: 'improvement-loop',
      // Fresh V2: nothing measured yet, so unsafeActionCount is null (unknown),
      // never 0 (measured clean).
      scores: { testPassRate: 0, benchmarkScore: 0, shadowAgreement: null, unsafeActionCount: null },
    })

    // 3. The copilot's latest version is now the V2 draft.
    await pgrest('PATCH', `copilots?${eq('id', copilotId)}`, { latest_version_id: v2VersionId, updated_at: now })

    // 4. Push the V2 behaviour to the copilot's assistant (config derives from
    //    the latest manifest — this is what makes the V2 actually RUN).
    await ensureCopilotAssistant({ copilotId })

    // 5. Stamp the V2 ids on the claimed proposal (status already 'v2-created').
    await pgrest('PATCH', `improvement_proposals?${eq('id', proposalId)}`, {
      v2_version_id: v2VersionId,
      v2_manifest_id: v2ManifestId,
    })
  } catch (err) {
    // Best-effort claim release so a mid-way failure keeps the pre-claim
    // behaviour: the proposal returns to 'proposed' and stays retryable.
    // Earlier rows still stay for operator cleanup (PostgREST has no
    // cross-table transaction) — the original error is what surfaces.
    try {
      await pgrest('PATCH', `improvement_proposals?${eq('id', proposalId)}&status=eq.v2-created`, {
        status: 'proposed',
        v2_version_id: null,
        v2_manifest_id: null,
      })
    } catch {
      // Release failed — the claim stays; the thrown error below is the signal.
    }
    throw err
  }

  return { v2VersionId, v2ManifestId, label }
}

// ---------------------------------------------------------------------------
// Comparison — recomputed live from test_runs/benchmark_runs, never persisted.
// ---------------------------------------------------------------------------

export interface SuiteComparison {
  suiteId: string
  suiteName: string
  v1: { runId: string; passRate: number; finishedAt: string | null } | null
  v2: { runId: string; passRate: number; finishedAt: string | null } | null
}

export interface BenchmarkComparison {
  suiteId: string
  suiteName: string
  v1: { runId: string; score: number } | null
  v2: { runId: string; score: number } | null
}

export interface VersionComparison {
  tests: SuiteComparison[]
  benchmarks: BenchmarkComparison[]
}

async function latestTestRunFor(suiteId: string, versionId: string): Promise<SuiteComparison['v1']> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `test_runs?${eq('suite_id', suiteId)}&${eq('version_id', versionId)}&status=eq.completed&select=id,pass_rate,finished_at&order=started_at.desc&limit=1`
  )
  const r = rows[0]
  return r ? { runId: r.id as string, passRate: (r.pass_rate as number) ?? 0, finishedAt: (r.finished_at as string | null) ?? null } : null
}

async function latestBenchmarkFor(suiteId: string, versionId: string): Promise<BenchmarkComparison['v1']> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `benchmark_runs?${eq('suite_id', suiteId)}&${eq('version_id', versionId)}&status=eq.completed&select=id&order=started_at.desc&limit=1`
  )
  if (!rows[0]) return null
  const resultRows = await pgrest<RawRow[]>('GET', `benchmark_results?${eq('run_id', rows[0].id as string)}&select=score`)
  return resultRows[0] ? { runId: rows[0].id as string, score: (resultRows[0].score as number) ?? 0 } : null
}

/** Latest completed run per suite for each version — the V1 vs V2 table. */
export async function compareImprovementVersions(
  copilotId: string,
  baseVersionId: string,
  v2VersionId: string
): Promise<VersionComparison> {
  const suiteRows = await pgrest<RawRow[]>('GET', `test_suites?${eq('copilot_id', copilotId)}&select=id,name&order=name`)
  const tests: SuiteComparison[] = []
  for (const s of suiteRows) {
    tests.push({
      suiteId: s.id as string,
      suiteName: (s.name as string) ?? (s.id as string),
      v1: await latestTestRunFor(s.id as string, baseVersionId),
      v2: await latestTestRunFor(s.id as string, v2VersionId),
    })
  }
  const benchSuiteRows = await pgrest<RawRow[]>('GET', `benchmark_suites?${eq('copilot_id', copilotId)}&select=id,name&order=name`)
  const benchmarks: BenchmarkComparison[] = []
  for (const b of benchSuiteRows) {
    benchmarks.push({
      suiteId: b.id as string,
      suiteName: (b.name as string) ?? (b.id as string),
      v1: await latestBenchmarkFor(b.id as string, baseVersionId),
      v2: await latestBenchmarkFor(b.id as string, v2VersionId),
    })
  }
  return { tests, benchmarks }
}

// ---------------------------------------------------------------------------
// Proposal reads + human decision.
// ---------------------------------------------------------------------------

function rowToProposal(r: RawRow): ImprovementProposal {
  return {
    id: r.id as string,
    copilotId: r.copilot_id as string,
    baseVersionId: r.base_version_id as string,
    v2VersionId: (r.v2_version_id as string | null) ?? null,
    v2ManifestId: (r.v2_manifest_id as string | null) ?? null,
    status: r.status as ImprovementProposal['status'],
    summary: (r.summary as string) ?? '',
    failureAnalysis: (r.failure_analysis as FailureAnalysisEntry[]) ?? [],
    manifestChanges: (r.manifest_changes as ImprovementManifestChanges) ?? {},
    sources: (r.sources as ImprovementSources) ?? { db: true, langgraph: false, langsmith: false, runtimeTelemetry: false },
    costUsd: (r.cost_usd as number) ?? 0,
    createdAt: r.created_at as string,
    createdBy: (r.created_by as string) ?? '',
    decidedBy: (r.decided_by as string | null) ?? null,
    decidedAt: (r.decided_at as string | null) ?? null,
  }
}

export async function getLatestProposalForCopilot(copilotId: string): Promise<ImprovementProposal | null> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `improvement_proposals?${eq('copilot_id', copilotId)}&select=*&order=created_at.desc&limit=1`
  )
  return rows[0] ? rowToProposal(rows[0]) : null
}

/**
 * Persist the HUMAN decision on a proposal. Approval requires an existing V2
 * (`v2-created`); rejection is allowed from `proposed` too. This is the gate
 * record only — promoting the V2 to production remains the existing promotion
 * route, always operator-triggered.
 */
export async function decideProposal(
  copilotId: string,
  proposalId: string,
  decision: 'approved' | 'rejected',
  decidedBy: string
): Promise<void> {
  const rows = await pgrest<RawRow[]>('GET', `improvement_proposals?${eq('id', proposalId)}&select=id,copilot_id,status`)
  if (rows.length === 0) throw new NotFoundError(`proposal not found: ${proposalId}`)
  if ((rows[0].copilot_id as string) !== copilotId) {
    throw new NotFoundError(`proposal ${proposalId} does not belong to copilot ${copilotId}`)
  }
  // Fast path only — the AUTHORITATIVE gate is the conditional PATCH below
  // (a plain read-then-check races a concurrent decision on the same row).
  const status = rows[0].status as string
  if (status === 'approved' || status === 'rejected') {
    throw new Error(`proposal already decided: ${status}`)
  }
  if (decision === 'approved' && status !== 'v2-created') {
    throw new Error('a proposal can only be approved after its V2 draft exists')
  }
  // ATOMIC transition: the PATCH itself re-checks the allowed FROM status, so
  // exactly one concurrent decision wins; the loser gets zero rows back.
  const allowedFrom = decision === 'approved' ? 'status=eq.v2-created' : 'status=in.(proposed,v2-created)'
  const updated = await pgrest<RawRow[]>('PATCH', `improvement_proposals?${eq('id', proposalId)}&${allowedFrom}`, {
    status: decision,
    decided_by: decidedBy,
    decided_at: new Date().toISOString(),
  })
  if (updated.length === 0) {
    // Lost the race — re-read to classify with the same errors as the fast path.
    const nowRows = await pgrest<RawRow[]>('GET', `improvement_proposals?${eq('id', proposalId)}&select=status`)
    if (nowRows.length === 0) throw new NotFoundError(`proposal not found: ${proposalId}`)
    const nowStatus = nowRows[0].status as string
    if (nowStatus === 'approved' || nowStatus === 'rejected') {
      throw new Error(`proposal already decided: ${nowStatus}`)
    }
    throw new Error('a proposal can only be approved after its V2 draft exists')
  }
}

// ---------------------------------------------------------------------------
// Auto-improvement orchestrator — chains the EXISTING bricks (analyze →
// create-v2 → re-run tests+benchmarks → compare) until the copilot converges
// (every test suite at pass rate 1.0), plateaus (a V2 that doesn't beat its
// base), or hits a hard iteration/budget ceiling.
//
// DOCTRINE (non-negotiable, enforced here):
//   • NEVER approves and NEVER promotes. `decideProposal('approved')` and the
//     promotion route are NEVER called. The loop always stops leaving the HEAD
//     proposal in `v2-created` with a measured V2 draft; approval + production
//     promotion stay 100% HUMAN (forbiddenActions: auto-promote to production).
//   • Bounded by MAX_ITERATIONS and a USD budget with STRICT defaults — without
//     them the loop would burn gpt-5.4. The budget is checked BEFORE each
//     create-v2 so a proposal that would blow the budget is never materialized.
//   • Fail-soft: any error inside an iteration emits an `error` event and stops
//     cleanly (never leaves the orchestrator mid-flight silently).
//
// OPEN-CYCLE GUARD — how the chain stays legal between iterations:
//   The "one open cycle at a time" rule lives in the HTTP analyze route, NOT in
//   `analyzeAndPropose` itself, so calling the FUNCTIONS directly bypasses the
//   409. But we must not leave a TRAIL of undecided `v2-created` proposals that
//   would then 409 the human UI. The chain is linear: each iteration's V2
//   becomes the next iteration's base (after create-v2, `latest_version_id`
//   already points at the V2, so the next `analyzeAndPropose` naturally analyzes
//   it). When a further iteration supersedes a prior V2, that prior proposal is
//   closed as `rejected` (the ONLY available non-promoting terminal state — the
//   DB CHECK allows only proposed/v2-created/approved/rejected, there is no
//   `superseded`). This is honest: the prior proposal is NOT the one to promote
//   because a better V2 already supersedes it — and it keeps EXACTLY ONE open
//   cycle (the current head) at every moment, so the human UI stays consistent.
//   The head proposal (last `v2-created`) is NEVER touched — it awaits the human.
// ---------------------------------------------------------------------------

const AUTO_IMPROVE_MAX_ITERATIONS = 5
const AUTO_IMPROVE_MAX_COST_USD = 2.0

export interface AutoImproveEvent {
  type: 'iteration-start' | 'analyzed' | 'v2-created' | 'reran' | 'converged' | 'plateau' | 'exhausted' | 'error'
  iteration: number
  /** Cumulative USD spent across analyze completions so far (present from the
   *  first `analyzed` event onward). */
  costUsd?: number
  /** Aggregate V2 pass rate (min across test suites) — on `reran`/`converged`/`plateau`. */
  passRate?: number
  /** Proposal id — on `analyzed` (and the events that follow it that iteration). */
  proposalId?: string
  /** V2 draft version id — on `v2-created` onward. */
  v2VersionId?: string
  /** Human-readable note (the stop reason, the error message, …). */
  detail?: string
}

/** Aggregate a comparison's V2 side into a single pass rate: the WORST suite
 *  (min). Convergence requires EVERY suite at 1.0, so the min is the honest
 *  headline. No V2 test run at all → 0 (nothing measured passes). */
function aggregateV2PassRate(cmp: VersionComparison): number {
  const rates = cmp.tests.map((t) => t.v2?.passRate ?? 0)
  return rates.length === 0 ? 0 : Math.min(...rates)
}

/** Same aggregate for the V1/base side of a comparison. */
function aggregateV1PassRate(cmp: VersionComparison): number {
  const rates = cmp.tests.map((t) => t.v1?.passRate ?? 0)
  return rates.length === 0 ? 0 : Math.min(...rates)
}

/** True when every test suite in the comparison has a V2 run at pass rate 1.0
 *  (and there is at least one suite to converge). */
function allSuitesConverged(cmp: VersionComparison): boolean {
  return cmp.tests.length > 0 && cmp.tests.every((t) => (t.v2?.passRate ?? 0) === 1)
}

export interface AutoImprovementResult {
  iterations: number
  finalPassRate: number
  stoppedBy: 'converged' | 'plateau' | 'max-iterations' | 'budget' | 'nothing-to-improve' | 'blocked'
  lastProposalId: string | null
  lastV2VersionId: string | null
  stopDetail?: string
}

/**
 * Drive the improvement loop automatically until convergence / plateau / limit /
 * budget, STOPPING BEFORE the human approval step (never approves, never
 * promotes). Calls the existing bricks directly:
 *   analyzeAndPropose → createImprovementV2 → runTestSuite/runBenchmarkSuite on
 *   the V2 → compareImprovementVersions → decide to continue or stop.
 *
 * @param copilotId  the copilot to improve.
 * @param opts.maxIterations  hard iteration ceiling (default 5).
 * @param opts.maxCostUsd     cumulative analyze-completion budget (default 2.0).
 * @param opts.onEvent        progress sink (each milestone is emitted).
 * @param opts.signal         optional abort signal, checked BETWEEN steps
 *                            (analyze / create-v2 / each re-run / compare): an
 *                            aborted caller (e.g. a closed SSE client) stops
 *                            the loop at the next boundary via an AbortError
 *                            instead of burning more OpenAI/LangGraph spend.
 *                            Never interrupts a step mid-flight, so no row is
 *                            left half-written by the abort itself.
 * @returns a terminal summary; `stoppedBy` says WHY it stopped. The head V2
 *          proposal (if any) is left `v2-created` for a human to decide.
 */
export async function runAutoImprovementCycle(
  copilotId: string,
  opts: {
    maxIterations?: number
    maxCostUsd?: number
    force?: boolean
    onEvent?: (ev: AutoImproveEvent) => void
    signal?: AbortSignal
  } = {}
): Promise<AutoImprovementResult> {
  const maxIterations = Math.max(1, Math.trunc(opts.maxIterations ?? AUTO_IMPROVE_MAX_ITERATIONS))
  const maxCostUsd = opts.maxCostUsd ?? AUTO_IMPROVE_MAX_COST_USD
  // Throws DOMException('AbortError') when the caller aborted — checked at
  // every step boundary so the loop never starts a new expensive step for a
  // caller that is gone.
  const checkAborted = () => opts.signal?.throwIfAborted()
  const emit = (ev: AutoImproveEvent) => {
    try {
      opts.onEvent?.(ev)
    } catch {
      // A misbehaving sink must never break the loop.
    }
  }

  // Suite ids to re-run the V2 against (resolved once — suites don't change
  // mid-loop; the loop only touches manifest behaviour, never test/bench rows).
  const testSuiteRows = await pgrest<RawRow[]>('GET', `test_suites?${eq('copilot_id', copilotId)}&select=id&order=name`)
  const benchSuiteRows = await pgrest<RawRow[]>('GET', `benchmark_suites?${eq('copilot_id', copilotId)}&select=id&order=name`)
  const testSuiteIds = testSuiteRows.map((r) => r.id as string)
  const benchSuiteIds = benchSuiteRows.map((r) => r.id as string)

  let cumulativeCostUsd = 0
  let finalPassRate = 0
  let lastProposalId: string | null = null
  let lastV2VersionId: string | null = null
  // The proposal from the PREVIOUS iteration that got superseded by a new head;
  // it is closed `rejected` (non-promoting) so only one open cycle survives.
  let supersededProposalId: string | null = null

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    checkAborted()
    emit({ type: 'iteration-start', iteration })

    // 1. ANALYZE — collect live signals, propose a validated manifest patch.
    //    `analyzeAndPropose` throws NotFoundError('nothing to improve…') when the
    //    copilot has converged — that is a CLEAN STOP, not a failure.
    let proposal: ImprovementProposal
    try {
      const analysis = await analyzeAndPropose(copilotId, 'auto-improve')
      proposal = analysis.proposal
    } catch (err) {
      if (err instanceof NotFoundError) {
        if (isNothingToImproveReason(err.message)) {
          emit({ type: 'converged', iteration, passRate: finalPassRate, detail: err.message })
          return { iterations: iteration - 1, finalPassRate, stoppedBy: 'nothing-to-improve', lastProposalId, lastV2VersionId }
        }
        emit({ type: 'error', iteration, detail: err.message })
        return {
          iterations: iteration - 1,
          finalPassRate,
          stoppedBy: 'blocked',
          lastProposalId,
          lastV2VersionId,
          stopDetail: err.message,
        }
      }
      emit({ type: 'error', iteration, detail: err instanceof Error ? err.message : 'analysis failed' })
      return { iterations: iteration - 1, finalPassRate, stoppedBy: 'plateau', lastProposalId, lastV2VersionId }
    }

    // 2. BUDGET — the analyze completion already spent tokens; if the running
    //    total is over budget, stop BEFORE materializing (create-v2 provisions
    //    an assistant + re-runs, we don't spend more on a run we can't afford).
    //    The proposal stays `proposed` for a human to inspect.
    cumulativeCostUsd += proposal.costUsd
    emit({ type: 'analyzed', iteration, proposalId: proposal.id, costUsd: cumulativeCostUsd })
    lastProposalId = proposal.id
    if (cumulativeCostUsd > maxCostUsd) {
      emit({
        type: 'exhausted',
        iteration,
        costUsd: cumulativeCostUsd,
        detail: `budget exhausted: $${cumulativeCostUsd.toFixed(4)} > $${maxCostUsd.toFixed(2)}`,
      })
      return { iterations: iteration, finalPassRate, stoppedBy: 'budget', lastProposalId, lastV2VersionId }
    }

    // 3. MATERIALIZE V2 — new manifest + draft version, assistant re-provisioned.
    checkAborted()
    let v2VersionId: string
    try {
      const v2 = await createImprovementV2(copilotId, proposal.id)
      v2VersionId = v2.v2VersionId
    } catch (err) {
      emit({ type: 'error', iteration, proposalId: proposal.id, detail: err instanceof Error ? err.message : 'create-v2 failed' })
      return { iterations: iteration, finalPassRate, stoppedBy: 'plateau', lastProposalId, lastV2VersionId }
    }
    lastV2VersionId = v2VersionId
    emit({ type: 'v2-created', iteration, proposalId: proposal.id, v2VersionId, costUsd: cumulativeCostUsd })

    // A new head exists — close the previous head (if any) as `rejected`: it is
    // superseded by this V2, non-promoting, keeping exactly one open cycle.
    if (supersededProposalId) {
      try {
        await decideProposal(copilotId, supersededProposalId, 'rejected', 'auto-improve:superseded')
      } catch (err) {
        // Non-fatal: the head is still correct; a stale prior row only matters
        // for the human UI's open-cycle count. Surface it, keep going.
        emit({
          type: 'error',
          iteration,
          proposalId: supersededProposalId,
          detail: `failed to close superseded proposal: ${err instanceof Error ? err.message : 'unknown'}`,
        })
      }
    }

    // 4. RE-RUN — the EXISTING runners, pinned to the V2 version id, on every
    //    test suite (and benchmark suite) so the comparison has V2 rows. These
    //    re-runs are the DOMINANT spend of the cycle (the analyze completion is
    //    a rounding error next to N test cases + a benchmark), so their cost
    //    MUST be metered against maxCostUsd — otherwise the budget bounded only
    //    the cheap analyze step and the loop could spend many multiples of it.
    try {
      for (const suiteId of testSuiteIds) {
        checkAborted()
        const testRun = await runTestSuite({ copilotId, suiteId, versionId: v2VersionId, triggeredBy: 'auto-improve' })
        cumulativeCostUsd += testRun.totalCostUsd ?? 0
      }
      for (const suiteId of benchSuiteIds) {
        checkAborted()
        const benchRun = await runBenchmarkSuite({ copilotId, suiteId, versionId: v2VersionId })
        if (benchRun.resultId) {
          const rows = await pgrest<Array<{ total_cost_usd: number | null }>>(
            'GET',
            `benchmark_results?${eq('id', benchRun.resultId)}&select=total_cost_usd&limit=1`
          )
          cumulativeCostUsd += Number(rows[0]?.total_cost_usd ?? 0)
        }
      }
    } catch (err) {
      // An abort is the CALLER stopping the loop, not a re-run failure —
      // propagate it instead of mislabelling it a plateau.
      if (opts.signal?.aborted) throw err
      emit({ type: 'error', iteration, proposalId: proposal.id, v2VersionId, detail: err instanceof Error ? err.message : 're-run failed' })
      return { iterations: iteration, finalPassRate, stoppedBy: 'plateau', lastProposalId, lastV2VersionId }
    }

    // 5. COMPARE — recomputed live from the runs just written.
    checkAborted()
    let cmp: VersionComparison
    try {
      cmp = await compareImprovementVersions(copilotId, proposal.baseVersionId, v2VersionId)
    } catch (err) {
      emit({ type: 'error', iteration, proposalId: proposal.id, v2VersionId, detail: err instanceof Error ? err.message : 'compare failed' })
      return { iterations: iteration, finalPassRate, stoppedBy: 'plateau', lastProposalId, lastV2VersionId }
    }

    const v2PassRate = aggregateV2PassRate(cmp)
    const basePassRate = aggregateV1PassRate(cmp)
    finalPassRate = v2PassRate
    emit({ type: 'reran', iteration, proposalId: proposal.id, v2VersionId, passRate: v2PassRate, costUsd: cumulativeCostUsd })

    // BUDGET (post-re-run) — now that the dominant re-run spend is counted, stop
    // if the running total is over budget. We keep this iteration's V2 (it is
    // already materialized and re-run) but do not fund another analyze+re-run
    // round the operator's cap can't afford. The head V2 awaits the human.
    if (cumulativeCostUsd > maxCostUsd) {
      emit({
        type: 'exhausted',
        iteration,
        proposalId: proposal.id,
        v2VersionId,
        costUsd: cumulativeCostUsd,
        detail: `budget exhausted after re-runs: $${cumulativeCostUsd.toFixed(4)} > $${maxCostUsd.toFixed(2)}`,
      })
      return { iterations: iteration, finalPassRate: v2PassRate, stoppedBy: 'budget', lastProposalId, lastV2VersionId }
    }

    // 6a. CONVERGED — every suite at 1.0. Stop; head V2 awaits the human.
    if (allSuitesConverged(cmp)) {
      emit({ type: 'converged', iteration, proposalId: proposal.id, v2VersionId, passRate: v2PassRate })
      return { iterations: iteration, finalPassRate: v2PassRate, stoppedBy: 'converged', lastProposalId, lastV2VersionId }
    }

    // 6b. PLATEAU — the V2 didn't beat its base. Stop; leave the head V2 open
    //     for human decision (it might still be a lateral fix worth keeping).
    if (v2PassRate <= basePassRate) {
      emit({
        type: 'plateau',
        iteration,
        proposalId: proposal.id,
        v2VersionId,
        passRate: v2PassRate,
        detail: `no improvement: V2 ${v2PassRate.toFixed(3)} <= base ${basePassRate.toFixed(3)}`,
      })
      if (!opts.force) {
        return { iterations: iteration, finalPassRate: v2PassRate, stoppedBy: 'plateau', lastProposalId, lastV2VersionId }
      }

      // `force` means "keep trying", NOT "accept a regression". Create-v2 already
      // moved `copilots.latest_version_id` onto this V2 (step 3), so leaving it
      // there would make the degraded version the next iteration's base — each
      // round would then propose on top of a worse agent and monotonically
      // decay. Roll the head back to the base and retry from it instead.
      await pgrest('PATCH', `copilots?${eq('id', copilotId)}`, {
        latest_version_id: proposal.baseVersionId,
        updated_at: new Date().toISOString(),
      })
      finalPassRate = basePassRate
      continue
    }

    // 6c. IMPROVED — advance: this V2 is the next base. Its proposal becomes the
    //     one to supersede on the NEXT iteration (so only one open cycle at a
    //     time). `latest_version_id` already points at it, so the next
    //     `analyzeAndPropose` analyzes it as base with no extra plumbing.
    supersededProposalId = proposal.id
  }

  // Ran out of iterations without converging — the head V2 is left open.
  emit({ type: 'exhausted', iteration: maxIterations, costUsd: cumulativeCostUsd, passRate: finalPassRate, detail: `reached max iterations (${maxIterations})` })
  return { iterations: maxIterations, finalPassRate, stoppedBy: 'max-iterations', lastProposalId, lastV2VersionId }
}
