/**
 * Agent Mission Control — execution runner (server only).
 *
 * LIVE ONLY. Executes a copilot run against the real OpenAI API and
 * persists the result to the gpu1 PostgREST perimeter (agent_runs +
 * agent_run_steps). There is no mock/dry-run mode: every call here either
 * produces a real completion + a real DB row, or throws.
 *
 * Required env: AMC_DATA_SOURCE=gpu1, AMC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * OPENAI_API_KEY (the latter is read inside ./llm-client).
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

import { summarize } from './format'
import { routeCompletion } from './model-router'
import { pgrest } from './postgrest'
import { startTrace, toDbStepKind, type TraceStep } from './run-trace'
import type {
  AgentRunStatus,
  AgentRunStepKind,
  DurationMs,
  IsoTimestamp,
  ModelProvider,
  UsdAmount,
} from './types'

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface ExecuteCopilotRunArgs {
  copilotId: string
  versionId: string
  projectId: string
  model: string
  /** Provider for `model`; defaults to 'openai' when the caller omits it. */
  modelProvider?: ModelProvider
  systemPromptSummary: string
  userInput: string
  maxSteps: number
  /** Per-request opt-in to run model fallbacks (OR-ed with the env flag). */
  allowFallback?: boolean
}

export interface ExecuteCopilotRunStep {
  index: number
  kind: AgentRunStepKind
  title: string
  detail: string
  status: 'ok' | 'warning' | 'blocked' | 'error'
  startedAt: IsoTimestamp
  durationMs: DurationMs
}

export interface ExecuteCopilotRunResult {
  runId: string
  status: AgentRunStatus
  outputSummary: string
  latencyMs: DurationMs
  costUsd: UsdAmount
  steps: ExecuteCopilotRunStep[]
  /** LangSmith deep-link, or null when LangSmith isn't configured (honest). */
  traceUrl: string | null
  /** Provider/model actually used (differs from requested on fallback). */
  resolvedProvider: ModelProvider
  resolvedModel: string
  fallbackUsed: boolean
}


/**
 * Execute one copilot run: call OpenAI with the copilot's system prompt +
 * user input, persist an agent_runs row and a matching agent_run_steps row,
 * and return the structured result. On OpenAI failure, still persists a
 * `failed` run so the run history stays complete.
 */
export async function executeCopilotRun(
  args: ExecuteCopilotRunArgs
): Promise<ExecuteCopilotRunResult> {
  const { copilotId, versionId, projectId, model, systemPromptSummary, userInput, maxSteps } = args
  const modelProvider: ModelProvider = args.modelProvider ?? 'openai'

  const startedAtMs = Date.now()
  const startedAt: IsoTimestamp = new Date(startedAtMs).toISOString()
  const runId = randomUUID()

  // A structured trace assembles the real timeline: resolve-model → llm-call →
  // (fallback marker) → output. Kinds map to DB-valid values on persist.
  const trace = startTrace(
    { runId, copilotId, versionId, projectId, mode: 'run', provider: modelProvider, model },
    startedAtMs
  )

  // Step 1 — model resolution (deterministic, ~0ms). Records the requested
  // provider/model before the call; the resolved pair is filled in after.
  trace.step(
    {
      kind: 'guardrail-check',
      title: 'Resolve model',
      detail: `Requested ${modelProvider}/${model || '(default)'} under the copilot manifest.`,
      status: 'ok',
      startedAt,
      durationMs: 0,
    },
    startedAtMs
  )

  let status: AgentRunStatus
  let outputSummary: string
  let costUsd: UsdAmount = 0
  let resolvedProvider: ModelProvider = modelProvider
  let resolvedModel: string = model
  let fallbackUsed = false

  const callStartMs = Date.now()
  try {
    // Route through the provider-aware model router (fallback-aware); cost is
    // normalised per provider/model by the router.
    const res = await routeCompletion({
      purpose: 'run',
      modelProvider,
      model,
      allowFallback: args.allowFallback,
      messages: [
        { role: 'system', content: systemPromptSummary },
        { role: 'user', content: userInput },
      ],
      maxOutputTokens: 4096,
    })

    const replyText = res.text
    costUsd = res.costUsd
    resolvedProvider = res.resolvedProvider
    resolvedModel = res.resolvedModel
    fallbackUsed = res.fallbackUsed
    trace.resolve(res.resolvedProvider, res.resolvedModel, res.fallbackUsed)

    // Step 2 — fallback marker (only when a fallback actually fired).
    if (res.fallbackUsed) {
      trace.step(
        {
          kind: 'fallback',
          title: 'Model fallback applied',
          detail: summarize(res.fallbackReason ?? 'primary model unavailable'),
          status: 'warning',
          durationMs: 0,
        },
        Date.now()
      )
    }

    // Step 3 — the LLM call itself.
    trace.step(
      {
        kind: 'llm-call',
        title: `LLM call · ${res.resolvedProvider}/${res.resolvedModel}`,
        detail: summarize(
          `in ${res.inputTokens} tok, out ${res.outputTokens} tok, finish ${res.rawFinishReason ?? 'stop'}`
        ),
        status: 'ok',
        durationMs: res.latencyMs,
      },
      Date.now()
    )

    // Step 4 — output.
    status = 'completed'
    outputSummary = summarize(replyText)
    trace.step(
      {
        kind: 'output',
        title: 'Model response',
        detail: summarize(replyText || '(empty response)'),
        status: 'ok',
        durationMs: 0,
      },
      Date.now()
    )
  } catch (err) {
    status = 'failed'
    const message = err instanceof Error ? err.message : String(err)
    outputSummary = summarize(`Model call failed: ${message}`)
    trace.step(
      {
        kind: 'llm-call',
        title: 'Model call failed',
        detail: outputSummary,
        status: 'error',
        durationMs: Date.now() - callStartMs,
      },
      Date.now()
    )
  }

  // maxSteps is the manifest ceiling; this runner emits a bounded, honest
  // timeline (resolve → [fallback] → llm-call → output) — no invented tool
  // calls. It never exceeds the cap.
  void maxSteps

  const finishedAtMs = Date.now()
  const finishedAt: IsoTimestamp = new Date(finishedAtMs).toISOString()
  const latencyMs: DurationMs = finishedAtMs - startedAtMs

  // Freeze + (maybe) export to LangSmith. Fail-open: a no-op/error export never
  // affects the run; trace_url stays null unless a real deep-link resolves.
  const traceResult = await trace.finishAndExport(
    { userInput: summarize(userInput) },
    { output: outputSummary, status },
    startedAt,
    finishedAt
  )

  // Persist agent_runs row (trace_url is real only if LangSmith is configured).
  await pgrest('POST', 'agent_runs', {
    id: runId,
    copilot_id: copilotId,
    version_id: versionId,
    project_id: projectId,
    user_label: 'authoring-session',
    started_at: startedAt,
    finished_at: finishedAt,
    status,
    input_summary: summarize(userInput),
    output_summary: outputSummary,
    tool_call_count: 0,
    unsafe_attempt_count: 0,
    latency_ms: latencyMs,
    cost_usd: costUsd,
    trace_url: traceResult.traceUrl,
    created_via: 'authoring',
  })

  // Persist every trace step as an agent_run_steps row (DB-valid kind).
  for (const s of traceResult.steps) {
    await pgrest('POST', 'agent_run_steps', {
      id: randomUUID(),
      run_id: runId,
      index: s.index,
      kind: toDbStepKind(s.kind) satisfies AgentRunStepKind,
      title: s.title,
      detail: s.detail,
      status: s.status,
      started_at: s.startedAt,
      duration_ms: s.durationMs,
      tool_call_id: s.toolCallId,
    })
  }

  const steps: ExecuteCopilotRunStep[] = traceResult.steps.map((s: TraceStep) => ({
    index: s.index,
    kind: toDbStepKind(s.kind),
    title: s.title,
    detail: s.detail,
    status: s.status,
    startedAt: s.startedAt,
    durationMs: s.durationMs,
  }))

  return {
    runId,
    status,
    outputSummary,
    latencyMs,
    costUsd,
    steps,
    traceUrl: traceResult.traceUrl,
    resolvedProvider,
    resolvedModel,
    fallbackUsed,
  }
}
