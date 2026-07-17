/**
 * Agent Mission Control — execution runner (server only).
 *
 * LIVE ONLY. Executes a copilot run against the real model provider and
 * persists the result to the gpu1 PostgREST perimeter (agent_runs +
 * agent_run_steps + tool_calls). There is no mock/dry-run mode: every call
 * here either produces a real completion + real DB rows, or throws.
 *
 * TOOL-USE: when the copilot's manifest declares tools, the runner drives a
 * real agentic loop — the model may request a tool, the runner runs a
 * guardrail check (allowed? risky? requires confirmation?), executes the tool
 * handler for real (read-only DB reads), feeds the result back, and loops
 * until the model produces a final answer or the manifest step budget is hit.
 * A write/confirmation-required tool is BLOCKED (never auto-executed) unless
 * the caller explicitly confirms it. No tool call is ever fabricated.
 *
 * Required env: AMC_DATA_SOURCE=gpu1, AMC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * OPENAI_API_KEY (the latter is read inside the model router).
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

import { resolveToolId } from './copilot-behavior'
import { summarize } from './format'
import {
  routeCompletion,
  type ModelRouterMessage,
  type ModelRouterTool,
  type ModelRouterToolCall,
} from './model-router'
import { runOnAgentServer } from './langgraph-server'
import { pgrest } from './postgrest'
import { resolveRunAssistantId } from './resolve-run-assistant'
import { startTrace, toDbStepKind, type TraceStep } from './run-trace'
import { TOOL_HANDLERS, type ToolHandlerResult } from './tool-handlers'
import type {
  AgentRuntime,
  AgentRunStatus,
  AgentRunStepKind,
  DurationMs,
  IsoTimestamp,
  ModelProvider,
  ToolRiskLevel,
} from './types'

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** One tool the copilot may call, as resolved from its manifest + tools rows. */
export interface RunnerTool {
  id: string
  name: string
  description: string
  riskLevel: ToolRiskLevel
  requiresConfirmation: boolean
}

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
  /**
   * Tools the copilot may call. When omitted, the runner loads them from the
   * manifest of `versionId` (so every caller gets tool-use without threading
   * the list through). Pass an explicit [] to force a tool-less run.
   */
  tools?: RunnerTool[]
  /**
   * Tool NAMES the caller has explicitly confirmed for this run. A tool with
   * requiresConfirmation is BLOCKED unless its name is here. Read-only tools
   * never need this.
   */
  confirmedToolNames?: string[]
  /**
   * The copilot's runtime. When 'langgraph', the run is executed by the
   * official LangGraph Agent Server (langgraph-server.ts) instead of the direct
   * model-router loop. When omitted, the runner loads it from the copilot row;
   * any non-'langgraph' value uses the direct loop.
   */
  runtime?: AgentRuntime
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
  /** Tool calls actually attempted (executed, blocked or errored). */
  toolCallCount: number
  /** Tool calls blocked by the confirmation gate. */
  blockedToolCount: number
  /** LangSmith deep-link, or null when LangSmith isn't configured (honest). */
  traceUrl: string | null
  /** Provider/model actually used (differs from requested on fallback). */
  resolvedProvider: ModelProvider
  /**
   * The model that ACTUALLY served the run, when it could be verified from
   * the provider's own response. Null means the real model is unknown — see
   * `modelUnverified`. Never a guess dressed up as a fact.
   */
  resolvedModel: string | null
  fallbackUsed: boolean
  /**
   * True when `resolvedModel` could NOT be verified against what actually ran
   * (the LangGraph path instantiates its model inside the graph from config,
   * with a silent env fallback — see agent-builder-graph.mjs's DEFAULT_MODEL —
   * so the requested model string is not proof of what executed). Callers
   * MUST NOT treat `resolvedModel`/`fallbackUsed` as ground truth when this is
   * true. The direct model-router path always verifies (routeCompletion
   * reports the real provider response), so it's always false there.
   */
  modelUnverified: boolean
  /**
   * LangGraph Agent Server thread id when the run went through it (else null).
   * A `needs-confirmation` run is resumed on this thread.
   */
  threadId: string | null
  /** True when the run paused for human approval (status 'needs-confirmation'). */
  interrupted: boolean
  /** The human-facing approval prompt when interrupted (else null). */
  interruptMessage: string | null
  /** The tool awaiting approval when interrupted (name + args for the operator), else null. */
  pendingTool: { name: string; argumentsSummary: string; risk?: string } | null
  /**
   * The FULL, untruncated model answer (the direct model-router path only).
   * `outputSummary` is capped at 400 chars for display/persistence; callers that
   * need to parse a structured (e.g. JSON) answer must use this. Null on the
   * LangGraph path or when no final text was produced.
   */
  fullText: string | null
}

type UsdAmount = number

// ---------------------------------------------------------------------------
// Tool loading — resolve the manifest's tools into RunnerTool[] (server-only).
// ---------------------------------------------------------------------------

type RawRow = Record<string, unknown>

/**
 * Load the tools the copilot may call from the manifest tied to `versionId`.
 * Returns [] when the version has no manifest or the manifest declares no
 * tools — a tool-less run (identical to the previous runner behaviour).
 */
async function loadToolsForVersion(versionId: string): Promise<RunnerTool[]> {
  const versionRows = await pgrest<RawRow[]>('GET', `copilot_versions?id=eq.${encodeURIComponent(versionId)}&select=manifest_id`)
  const manifestId = versionRows[0]?.manifest_id as string | null | undefined
  if (!manifestId) return []

  const manifestRows = await pgrest<RawRow[]>('GET', `manifests?id=eq.${encodeURIComponent(manifestId)}&select=tool_ids`)
  const toolIds = (manifestRows[0]?.tool_ids as string[] | null | undefined) ?? []
  if (toolIds.length === 0) return []

  const inList = toolIds.map((id) => `"${id}"`).join(',')
  const toolRows = await pgrest<RawRow[]>(
    'GET',
    `tools?id=in.(${encodeURIComponent(inList)})&select=id,name,description,risk_level,requires_confirmation`
  )
  return toolRows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? '',
    riskLevel: (r.risk_level as ToolRiskLevel) ?? 'low',
    requiresConfirmation: r.requires_confirmation === true,
  }))
}

/** Load the copilot's runtime (to decide the execution engine). */
async function loadRuntime(copilotId: string): Promise<AgentRuntime | null> {
  const rows = await pgrest<RawRow[]>('GET', `copilots?id=eq.${encodeURIComponent(copilotId)}&select=runtime`)
  return (rows[0]?.runtime as AgentRuntime | undefined) ?? null
}

/**
 * Load the project's repo full name (owner/name), or null when the project
 * has none. Mirrors langgraph-assistants.ts's loadCopilotBehaviorConfig — used
 * here only to know whether resolveToolId should prefer repo-file intent
 * (mirrors what the assistant's own config was built with) when checking for
 * tools the graph could not mount.
 */
async function loadRepoFullName(projectId: string | null): Promise<string | null> {
  if (!projectId) return null
  const rows = await pgrest<RawRow[]>('GET', `projects?id=eq.${encodeURIComponent(projectId)}&select=repo_full_name`)
  return (rows[0]?.repo_full_name as string | null) ?? null
}

/**
 * Tool NAMES the manifest declares that resolve to NO real registry id (see
 * resolveToolId in copilot-behavior.ts) — i.e. names the graph's assistant
 * config could not have mounted a tool for. Used to raise a visible warning
 * step in the run trace: the assistant's config.configurable was built with
 * the exact same resolution, so a name unmapped here is guaranteed unmapped
 * there too (same pure function, same inputs).
 */
function findUnmappedToolNames(tools: RunnerTool[], hasRepo: boolean): string[] {
  return tools.filter((t) => resolveToolId(t.name, hasRepo) === null).map((t) => t.name)
}

/** Map a RunnerTool to the router's tool schema (permissive object args). */
function toRouterTool(t: RunnerTool): ModelRouterTool {
  return {
    name: t.name,
    description: t.description,
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: true,
    },
  }
}

// ---------------------------------------------------------------------------
// Guardrail — decide whether a requested tool may execute.
// ---------------------------------------------------------------------------

type GuardrailVerdict =
  | { allow: true; tool: RunnerTool }
  | { allow: false; reason: string; blocked: boolean; tool?: RunnerTool }

/**
 * Gate a model-requested tool call against the manifest:
 *  - unknown tool (not in the allowlist) → denied (not blocked, just refused)
 *  - no registered handler → denied
 *  - requiresConfirmation and not confirmed → BLOCKED (safety), never executed
 *  - otherwise → allowed
 */
function guardrailCheck(
  call: ModelRouterToolCall,
  tools: RunnerTool[],
  confirmed: Set<string>
): GuardrailVerdict {
  const tool = tools.find((t) => t.name === call.name)
  if (!tool) {
    return { allow: false, reason: `tool '${call.name}' is not in the manifest allowlist`, blocked: false }
  }
  if (!TOOL_HANDLERS[tool.name]) {
    return { allow: false, reason: `tool '${tool.name}' has no registered handler`, blocked: false, tool }
  }
  if (tool.requiresConfirmation && !confirmed.has(tool.name)) {
    return {
      allow: false,
      reason: `tool '${tool.name}' requires human confirmation (${tool.riskLevel} risk) — blocked pending approval`,
      blocked: true,
      tool,
    }
  }
  return { allow: true, tool }
}

// ---------------------------------------------------------------------------
// LangGraph execution path — delegates to the OFFICIAL LangGraph Agent Server
// (langgraphjs dev, the same server LangSmith Studio connects to) via the SDK.
// No embedded engine: the server owns the graph, checkpointing, streaming and
// interrupt/resume. We persist its result into agent_runs / agent_run_steps /
// tool_calls with the same shape as the direct loop. A run that pauses for
// human approval (interrupt) is persisted as `needs-confirmation`, resumable
// on its thread id.
// ---------------------------------------------------------------------------

interface ViaLangGraphArgs {
  copilotId: string
  versionId: string
  projectId: string
  model: string
  userInput: string
  /** Manifest step ceiling — bounds the Agent Server's recursion_limit. */
  maxSteps: number
}

async function executeViaLangGraph(args: ViaLangGraphArgs): Promise<ExecuteCopilotRunResult> {
  const { copilotId, versionId, projectId, model, userInput, maxSteps } = args

  const startedAtMs = Date.now()
  const startedAt: IsoTimestamp = new Date(startedAtMs).toISOString()
  const runId = randomUUID()

  const trace = startTrace(
    { runId, copilotId, versionId, projectId, mode: 'run', provider: 'openai', model }
  )
  // NOTE: we deliberately do NOT call trace.resolve() here with the requested
  // `model` — executeViaLangGraph never routes through the model-router, so
  // the requested model is not proof of what the graph actually ran (it
  // instantiates its own ChatOpenAI from the assistant config, with a silent
  // env fallback — see agent-builder-graph.mjs DEFAULT_MODEL). We resolve the
  // trace AFTER the run, once/if the real model is readable from the graph's
  // own response metadata (see below).

  let status: AgentRunStatus = 'completed'
  let outputSummary: string
  let costUsd = 0
  let toolCallCount = 0
  let blockedToolCount = 0
  let threadId: string | null = null
  let interrupted = false
  let interruptMessage: string | null = null
  let pendingTool: { name: string; argumentsSummary: string; risk?: string } | null = null
  // Real model, verified from the graph's provider response (see
  // langgraph-server.ts's realModelFromMessages). Null until/unless verified —
  // never defaults to the requested `model`, which would be exactly the lie
  // this fixes (see module header BUG A).
  let resolvedModel: string | null = null
  let modelUnverified = true
  const toolCallRows: RawRow[] = []

  // Resolve the run's assistant via the shared cascade: the copilot's OWN
  // assistant (0009, carries its full behaviour config) first, then the
  // project's assistant (0008), then undefined → shared agent_builder graph id
  // inside runOnAgentServer. One helper, used identically by runner/test-runner/
  // resume — never re-implemented.
  const assistantId = await resolveRunAssistantId(copilotId)

  trace.step(
    {
      kind: 'guardrail-check',
      title: 'Dispatch to LangGraph Agent Server',
      detail: assistantId
        ? `Executing on the copilot's dedicated assistant ${assistantId} (shared agent_builder graph, behaviour from config.configurable).`
        : 'Executing on the shared agent_builder graph (copilot has no dedicated assistant yet).',
      status: 'ok',
      startedAt,
      durationMs: 0,
    },
    startedAtMs
  )

  // Map tool NAME → its DB row (id + risk) so persisted tool_calls carry the
  // real tool_id (a NOT NULL column). The Agent Server reports names, not ids.
  const copilotTools = await loadToolsForVersion(versionId)
  const toolByName = new Map(copilotTools.map((t) => [t.name, t]))

  // Visibility for P0-2: the manifest can declare tool NAMES that resolve to
  // NO real registry id (buildTools in copilot-behavior.ts silently drops
  // them into the assistant's config — same resolution, same inputs, so a
  // name unmapped here is guaranteed unmapped in the graph's actual tool
  // list too). Previously this only reached a server console.warn; surface it
  // as a `warning` trace step so the operator sees, in the run timeline, that
  // the copilot ran with fewer tools than its manifest declares. This never
  // fails the run — most copilots run fine on the injected repo tools +
  // platform reads even when some manifest tool names don't resolve.
  if (copilotTools.length > 0) {
    const repoFullName = await loadRepoFullName(projectId)
    const unmapped = findUnmappedToolNames(copilotTools, Boolean(repoFullName))
    if (unmapped.length > 0) {
      trace.step(
        {
          kind: 'guardrail-check',
          title: 'Manifest tools not mounted',
          detail: summarize(
            `${unmapped.length} tool name${unmapped.length === 1 ? '' : 's'} declared by the manifest ` +
              `mapped to no real tool and were not mounted: ${unmapped.join(', ')}. The copilot ran with ` +
              `platform reads${repoFullName ? ' + repo tools' : ''} only for these — its system prompt may ` +
              `assume a capability it does not have.`
          ),
          status: 'warning',
          durationMs: 0,
        },
        Date.now()
      )
    }
  }

  try {
    const result = await runOnAgentServer({ userInput, assistantId, maxSteps })

    for (const s of result.steps) {
      trace.step({ kind: s.kind, title: s.title, detail: s.detail, status: s.status, durationMs: s.durationMs }, Date.now())
    }
    for (const tc of result.toolCalls) {
      toolCallCount += 1
      if (tc.status === 'blocked') blockedToolCount += 1
      const dbTool = toolByName.get(tc.toolName)
      toolCallRows.push({
        id: randomUUID(),
        run_id: runId,
        tool_id: dbTool?.id ?? tc.toolName,
        tool_name: tc.toolName,
        arguments_summary: tc.argumentsSummary || '{}',
        result_summary: tc.resultSummary,
        status: tc.status,
        risk_level: dbTool?.riskLevel ?? 'low',
        required_confirmation: dbTool?.requiresConfirmation ?? tc.status === 'blocked',
        latency_ms: 0,
      })
    }
    costUsd = result.costUsd
    threadId = result.threadId

    // Reflect the model the graph ACTUALLY ran on (see langgraph-server.ts's
    // realModelFromMessages), never the requested `model`. When the graph
    // produced no AI message with resolvable response metadata (e.g. it
    // interrupted before any model call — shouldn't happen given the graph
    // shape, but never assume), resolvedModel stays null and modelUnverified
    // stays true rather than defaulting to a guess.
    if (result.resolvedModel) {
      resolvedModel = result.resolvedModel
      modelUnverified = false
      trace.resolve('openai', result.resolvedModel, result.resolvedModel !== model)
      if (result.resolvedModel !== model) {
        trace.step(
          {
            kind: 'fallback',
            title: 'Graph ran on a different model than requested',
            detail: summarize(
              `Requested ${model || '(none configured)'}, graph actually ran ${result.resolvedModel}.`
            ),
            status: 'warning',
            durationMs: 0,
          },
          Date.now()
        )
      }
    }

    if (result.interrupted) {
      // The graph paused for human approval — persist as needs-confirmation,
      // keeping the thread id so a later resume request can continue it.
      status = 'needs-confirmation'
      interrupted = true
      interruptMessage = result.interruptMessage
      pendingTool = result.pendingTool ?? null
      outputSummary = summarize(result.interruptMessage ?? 'Awaiting human approval for a tool call.')
    } else if (result.budgetExhausted) {
      // The graph hit its own maxSteps guard (agent-builder-graph.mjs) and said
      // so via a STRUCTURED marker on its final message — not by prose we'd have
      // to parse. The task was NOT finished, so `completed` would be a lie. The
      // DB CHECK (supabase/migrations/0001_agent_mission_control.sql:142) has no
      // `incomplete` value, so `failed` is the honest choice available.
      status = 'failed'
      outputSummary = summarize(result.finalText)
    } else {
      outputSummary = summarize(result.finalText || '(empty response)')
    }
  } catch (err) {
    status = 'failed'
    const message = err instanceof Error ? err.message : String(err)
    outputSummary = summarize(`LangGraph Agent Server run failed: ${message}`)
    trace.step({ kind: 'llm-call', title: 'Agent Server run failed', detail: outputSummary, status: 'error', durationMs: 0 }, Date.now())
  }

  const finishedAtMs = Date.now()
  const finishedAt: IsoTimestamp = new Date(finishedAtMs).toISOString()
  const latencyMs: DurationMs = finishedAtMs - startedAtMs
  // A run paused for approval is NOT finished — leave finished_at null so
  // duration/latency metrics don't count a pending run as complete.
  const isPaused = status === 'needs-confirmation'

  const traceResult = await trace.finishAndExport(
    { userInput: summarize(userInput) },
    { output: outputSummary, status },
    startedAt,
    finishedAt
  )

  await pgrest('POST', 'agent_runs', {
    id: runId,
    copilot_id: copilotId,
    version_id: versionId,
    project_id: projectId,
    user_label: 'authoring-session',
    started_at: startedAt,
    finished_at: isPaused ? null : finishedAt,
    status,
    input_summary: summarize(userInput),
    output_summary: outputSummary,
    tool_call_count: toolCallCount,
    unsafe_attempt_count: blockedToolCount,
    latency_ms: latencyMs,
    cost_usd: costUsd,
    trace_url: traceResult.traceUrl,
    thread_id: threadId,
    created_via: 'authoring',
  })
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
  for (const row of toolCallRows) {
    await pgrest('POST', 'tool_calls', row)
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
    toolCallCount,
    blockedToolCount,
    traceUrl: traceResult.traceUrl,
    resolvedProvider: 'openai',
    resolvedModel,
    // Honest only when verified: true iff we confirmed the graph ran on a
    // model different from what was requested. Never true/false by default
    // when unverified — modelUnverified is the signal callers must check.
    fallbackUsed: !modelUnverified && resolvedModel !== model,
    modelUnverified,
    threadId,
    interrupted,
    interruptMessage,
    pendingTool,
    // LangGraph path: the full answer lives in the persisted steps; expose null
    // here (the direct model-router path is the one that carries fullText).
    fullText: null,
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Execute one copilot run: call the model with the copilot's system prompt +
 * user input and its tool set, drive the real tool-use loop, persist an
 * agent_runs row plus one agent_run_steps row per trace step and one
 * tool_calls row per attempted tool, and return the structured result. On
 * model failure, still persists a `failed` run so the run history stays
 * complete.
 */
export async function executeCopilotRun(
  args: ExecuteCopilotRunArgs
): Promise<ExecuteCopilotRunResult> {
  const { copilotId, versionId, projectId, model, systemPromptSummary, userInput, maxSteps } = args
  const modelProvider: ModelProvider = args.modelProvider ?? 'openai'
  const confirmed = new Set(args.confirmedToolNames ?? [])

  // Resolve the runtime: explicit wins, else load from the copilot row. A
  // 'langgraph' runtime delegates to the official LangGraph Agent Server, which
  // owns the graph + tools — so we skip the local tool-loading entirely.
  const runtime = args.runtime ?? (await loadRuntime(copilotId))
  if (runtime === 'langgraph') {
    return executeViaLangGraph({ copilotId, versionId, projectId, model, userInput, maxSteps })
  }

  // Direct model-router path: resolve the tool set from the manifest.
  const tools = args.tools ?? (await loadToolsForVersion(versionId))
  const routerTools = tools.map(toRouterTool)

  const startedAtMs = Date.now()
  const startedAt: IsoTimestamp = new Date(startedAtMs).toISOString()
  const runId = randomUUID()

  const trace = startTrace(
    { runId, copilotId, versionId, projectId, mode: 'run', provider: modelProvider, model }
  )

  // Step 1 — model resolution.
  trace.step(
    {
      kind: 'guardrail-check',
      title: 'Resolve model',
      detail: `Requested ${modelProvider}/${model || '(default)'} · ${tools.length} tool${tools.length === 1 ? '' : 's'} available.`,
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
  let toolCallCount = 0
  let blockedToolCount = 0
  // tool_calls rows to persist after the run row exists.
  const toolCallRows: RawRow[] = []

  // Conversation state for the agentic loop.
  const messages: ModelRouterMessage[] = [
    { role: 'system', content: systemPromptSummary },
    { role: 'user', content: userInput },
  ]

  // maxSteps is the manifest ceiling on model turns. Guarantee at least 1.
  const maxTurns = Math.max(1, maxSteps)

  // Hoisted to function scope so the return can expose the untruncated answer
  // as `fullText` (the try/catch below assigns it).
  let finalText = ''

  try {
    let turn = 0
    let resolvedThisRun = false

    for (; turn < maxTurns; turn += 1) {
      const res = await routeCompletion({
        purpose: 'run',
        modelProvider,
        model,
        allowFallback: args.allowFallback,
        messages,
        maxOutputTokens: 4096,
        tools: routerTools.length > 0 ? routerTools : undefined,
        toolChoice: routerTools.length > 0 ? 'auto' : undefined,
      })

      costUsd += res.costUsd
      if (!resolvedThisRun) {
        resolvedProvider = res.resolvedProvider
        resolvedModel = res.resolvedModel
        fallbackUsed = res.fallbackUsed
        trace.resolve(res.resolvedProvider, res.resolvedModel, res.fallbackUsed)
        resolvedThisRun = true

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
      }

      // The llm-call step for this turn.
      trace.step(
        {
          kind: 'llm-call',
          title: `LLM call · ${res.resolvedProvider}/${res.resolvedModel}`,
          detail: summarize(
            `turn ${turn + 1}/${maxTurns} · in ${res.inputTokens} tok, out ${res.outputTokens} tok, finish ${res.rawFinishReason ?? 'stop'}`
          ),
          status: 'ok',
          durationMs: res.latencyMs,
        },
        Date.now()
      )

      const requestedCalls = res.toolCalls ?? []
      if (requestedCalls.length === 0) {
        // No tool requested → this is the final answer.
        finalText = res.text
        break
      }

      // Record the assistant turn (content + the tool calls it requested) so
      // the next turn's history is well-formed for the provider.
      messages.push({ role: 'assistant', content: res.text, toolCalls: requestedCalls })

      // Execute each requested tool through the guardrail.
      for (const call of requestedCalls) {
        toolCallCount += 1
        const verdict = guardrailCheck(call, tools, confirmed)

        if (!verdict.allow) {
          if (verdict.blocked) blockedToolCount += 1
          // guardrail-check step (blocked or denied — both are safety outcomes).
          trace.step(
            {
              kind: verdict.blocked ? 'confirmation' : 'guardrail-check',
              title: verdict.blocked ? `Blocked · ${call.name}` : `Denied · ${call.name}`,
              detail: summarize(verdict.reason),
              status: 'blocked',
              durationMs: 0,
            },
            Date.now()
          )
          toolCallRows.push({
            id: randomUUID(),
            run_id: runId,
            tool_id: verdict.tool?.id ?? null,
            tool_name: call.name,
            arguments_summary: summarize(call.argumentsJson || '{}'),
            result_summary: summarize(verdict.reason),
            status: verdict.blocked ? 'blocked' : 'rejected',
            risk_level: verdict.tool?.riskLevel ?? 'low',
            required_confirmation: verdict.tool?.requiresConfirmation ?? false,
            latency_ms: 0,
          })
          // Feed the refusal back so the model can adapt (e.g. explain to user).
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            content: JSON.stringify({ ok: false, blocked: verdict.blocked, reason: verdict.reason }),
          })
          continue
        }

        // Allowed → execute the real handler.
        const tool = verdict.tool
        const callStart = Date.now()
        let result: ToolHandlerResult
        try {
          result = await TOOL_HANDLERS[tool.name](call.argumentsJson, { copilotId })
        } catch (err) {
          result = {
            ok: false,
            data: { error: err instanceof Error ? err.message : String(err) },
            summary: `tool ${tool.name} threw`,
          }
        }
        const callLatency = Date.now() - callStart

        trace.step(
          {
            kind: 'tool-call',
            title: `Tool · ${tool.name}`,
            detail: summarize(result.summary),
            status: result.ok ? 'ok' : 'error',
            durationMs: callLatency,
            toolCallId: call.id,
          },
          Date.now()
        )
        toolCallRows.push({
          id: randomUUID(),
          run_id: runId,
          tool_id: tool.id,
          tool_name: tool.name,
          arguments_summary: summarize(call.argumentsJson || '{}'),
          result_summary: summarize(result.summary),
          status: result.ok ? 'ok' : 'error',
          risk_level: tool.riskLevel,
          required_confirmation: tool.requiresConfirmation,
          latency_ms: callLatency,
        })
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify({ ok: result.ok, data: result.data }),
        })
      }
      // Loop: next turn lets the model use the tool results (or finish).
    }

    if (turn >= maxTurns && finalText === '') {
      // Hit the step budget without a final answer — the task did NOT finish.
      // `agent_runs.status` has no dedicated "incomplete" value (its CHECK
      // constraint only allows completed/failed/blocked/needs-confirmation/
      // running — see supabase/migrations/0001_agent_mission_control.sql:142),
      // so `failed` is the most honest value the DB accepts: a run that never
      // produced a final answer is not a success, and `blocked` would falsely
      // imply a guardrail/approval gate rather than an exhausted step budget.
      status = 'failed'
      outputSummary = summarize('Reached the manifest step budget before a final answer.')
      trace.step(
        {
          kind: 'output',
          title: 'Step budget reached',
          detail: outputSummary,
          status: 'warning',
          durationMs: 0,
        },
        Date.now()
      )
    } else {
      status = 'completed'
      outputSummary = summarize(finalText || '(empty response)')
      trace.step(
        {
          kind: 'output',
          title: 'Model response',
          detail: outputSummary,
          status: 'ok',
          durationMs: 0,
        },
        Date.now()
      )
    }
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
        durationMs: 0,
      },
      Date.now()
    )
  }

  const finishedAtMs = Date.now()
  const finishedAt: IsoTimestamp = new Date(finishedAtMs).toISOString()
  const latencyMs: DurationMs = finishedAtMs - startedAtMs

  // Freeze + (maybe) export to LangSmith. Fail-open.
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
    tool_call_count: toolCallCount,
    unsafe_attempt_count: blockedToolCount,
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

  // Persist tool_calls rows (real attempts — executed, blocked or errored).
  for (const row of toolCallRows) {
    await pgrest('POST', 'tool_calls', row)
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
    toolCallCount,
    blockedToolCount,
    traceUrl: traceResult.traceUrl,
    resolvedProvider,
    resolvedModel,
    fallbackUsed,
    // The direct model-router path always calls the real provider through
    // routeCompletion and reports its actual response — always verified.
    modelUnverified: false,
    // The direct model-router path has no Agent Server thread and never
    // interrupts for human approval.
    threadId: null,
    interrupted: false,
    interruptMessage: null,
    pendingTool: null,
    fullText: finalText || null,
  }
}
