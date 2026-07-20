/**
 * Agent Mission Control — LangGraph Agent Server run/resume (server only).
 *
 * The app does NOT embed a LangGraph engine. Runs for a `langgraph`-runtime
 * copilot are executed by the official LangGraph Agent Server (`langgraphjs
 * dev`, started alongside `next dev`), reached here via the official SDK
 * (@langchain/langgraph-sdk). This module is the thin client: create a thread,
 * run the graph, surface an interrupt (human-in-the-loop) or the final answer,
 * and hand back a normalized shape the runner persists into agent_runs.
 *
 * The Agent Server owns checkpointing, streaming, interrupt/resume and thread
 * state — the same server LangSmith Studio connects to. There is no bespoke
 * runtime here.
 *
 * A run/resume targets an ASSISTANT when one is given (a project's dedicated
 * assistant on the shared `agent_builder` graph) — that makes each project a
 * distinct entity in Studio. Absent (copilot on the bench, or a legacy project
 * with no assistant yet), it falls back to the bare graph id. The client and
 * graph id come from the shared factory (langgraph-client.ts) — no duplicated
 * auth logic here.
 *
 * The server itself reads OPENAI_API_KEY + the gpu1 perimeter from .env.local.
 */
import 'server-only'

import type { StreamMode } from '@langchain/langgraph-sdk'

import { agentServerClient, AGENT_BUILDER_GRAPH_ID } from './langgraph-client'
import { computeCostUsd } from './model-pricing'
import type { DurationMs } from './types'

/** The Agent Server SDK client type (the shared factory's return). */
type AgentServerClient = ReturnType<typeof agentServerClient>

/** The model the Agent Server graph runs on (mirrors AGENT_BUILDER_MODEL). */
function graphModel(): string {
  return process.env.AGENT_BUILDER_MODEL || 'gpt-5.4'
}

/**
 * Sum the run's USD cost from the AI messages' usage_metadata, or return null
 * when the run carried NO provider usage at all. Priced against the model that
 * ACTUALLY served the run when readable (response_metadata.model_name — see
 * realModelFromMessages), else the env-configured graphModel(). Pricing itself
 * stays an estimate per model-pricing.ts's disclaimer; this only fixes WHICH
 * model's price is looked up.
 *
 * TRUTH FIX (AIG-AGENT-QUALITY-005 F1): the LangGraph stream does not surface
 * usage_metadata readably, so a run's real token usage is often unmeasurable.
 * The previous version fell back to estimating tokens from message content —
 * which yields 0 for a tool-call AI message (empty content), a FALSE zero that
 * looks like a genuinely-free run. When NO AI message carries provider usage,
 * the cost is UNMEASURED and we return null (→ persisted as NULL, unavailable),
 * never a fabricated 0 or a content-guessed estimate.
 */
export function costFromMessages(messages: AnyMsg[]): number | null {
  const model = realModelFromMessages(messages) ?? graphModel()
  let total = 0
  let sawUsage = false
  for (const m of messages) {
    const type = m.type ?? m.role
    if (type !== 'ai' && type !== 'assistant') continue
    const usage = m.usage_metadata
    if (!usage || (usage.input_tokens == null && usage.output_tokens == null)) continue
    sawUsage = true
    total += computeCostUsd('openai', model, usage.input_tokens ?? 0, usage.output_tokens ?? 0)
  }
  return sawUsage ? Math.round(total * 1e6) / 1e6 : null
}

export interface LangGraphServerStep {
  kind: 'llm-call' | 'tool-call' | 'guardrail-check' | 'confirmation' | 'output'
  title: string
  detail: string
  status: 'ok' | 'warning' | 'blocked' | 'error'
  durationMs: DurationMs
}

interface LangGraphServerToolCall {
  toolName: string
  argumentsSummary: string
  resultSummary: string
  status: 'ok' | 'error' | 'blocked'
}

export interface LangGraphServerResult {
  /** Thread id — resumable (an interrupted run continues on this thread). */
  threadId: string
  /** True when the graph paused for human approval (a write/confirm tool). */
  interrupted: boolean
  /** Human-facing prompt when interrupted (the approval question). */
  interruptMessage: string | null
  /** The tool awaiting approval (only set when interrupted) — name + args for the operator. */
  pendingTool?: { name: string; argumentsSummary: string; risk?: string }
  finalText: string
  steps: LangGraphServerStep[]
  toolCalls: LangGraphServerToolCall[]
  /** Null when the run carried no provider usage (unmeasured — never a fake 0). */
  costUsd: number | null
  /**
   * The model the graph ACTUALLY instantiated, read from its `executedModel`
   * state channel (agent-builder-graph.mjs) — a verified fact the graph owns,
   * already resolved (cfg.model vs DEFAULT_MODEL). Falls back to a provider
   * response-metadata read for any path that surfaces one. Null only when the
   * graph wrote nothing (e.g. an empty run) — never a guess.
   */
  resolvedModel: string | null
  /**
   * True when the graph stopped because the copilot's step budget was exhausted —
   * read from a STRUCTURED marker the graph sets, never by string-matching its
   * human-facing message. The task was NOT finished: the caller must not persist
   * such a run as `completed`.
   */
  budgetExhausted: boolean
}

const short = (s: string, n = 220): string => (s && s.length > n ? `${s.slice(0, n - 1)}…` : (s ?? ''))

/** SDK's own default recursion limit — our floor so we never UNDER-budget a run. */
const SDK_DEFAULT_RECURSION_LIMIT = 25
/** Hard ceiling so a misconfigured maxSteps can't hand the server an unbounded run. */
const RECURSION_LIMIT_CAP = 150
/**
 * Graph nodes consumed per logical step. The graph cycles
 * agent → approval → tools (parallel_tool_calls:false → ONE tool per turn), so a
 * single tool call costs ~3 super-steps, not 2 — under-counting throws
 * GraphRecursionError mid-run.
 */
const NODES_PER_STEP = 3

/**
 * Derive the SDK's `recursion_limit` from the copilot's logical step budget.
 *
 * Budget = NODES_PER_STEP × maxSteps  (the tool-calling turns)
 *          + NODES_PER_STEP           (headroom for the graph's own budget-guard
 *                                       CLOSING turn — agentNode takes one extra
 *                                       tool-free turn to synthesize a bounded
 *                                       answer when the budget is reached; that
 *                                       turn must fit UNDER the SDK limit or the
 *                                       run dies with GraphRecursionError before
 *                                       the answer is produced — the exact
 *                                       Security Sentinel failure)
 *          + 1                        (the terminal edge to END).
 * Floored at the SDK default so we never constrain a run tighter than the
 * out-of-the-box 25, and capped so a misconfigured maxSteps can't run unbounded.
 * Returns undefined when maxSteps is undefined (or not finite) so callers keep
 * the SDK default unchanged.
 */
function recursionLimitFor(maxSteps: number | undefined): number | undefined {
  if (maxSteps === undefined || !Number.isFinite(maxSteps)) return undefined
  const derived = Math.max(1, Math.floor(maxSteps)) * NODES_PER_STEP + NODES_PER_STEP + 1
  return Math.min(Math.max(derived, SDK_DEFAULT_RECURSION_LIMIT), RECURSION_LIMIT_CAP)
}

/**
 * The SDK replaces an assistant's stored config when a per-run config is
 * supplied. Preserve `configurable` (prompt/model/tools) while adding the
 * recursion limit, otherwise the graph falls back to its legacy generic tools.
 */
async function runConfigWithAssistantBehavior(
  client: AgentServerClient,
  assistantId: string | undefined,
  recursionLimit: number | undefined
): Promise<Record<string, unknown> | undefined> {
  if (recursionLimit === undefined) return undefined
  if (!assistantId) return { recursion_limit: recursionLimit }

  const assistant = await client.assistants.get(assistantId)
  const stored =
    assistant.config && typeof assistant.config === 'object' && !Array.isArray(assistant.config)
      ? assistant.config
      : {}
  return { ...stored, recursion_limit: recursionLimit }
}

type AnyMsg = {
  type?: string
  role?: string
  content?: unknown
  name?: string
  tool_call_id?: string
  tool_calls?: { id?: string; name: string; args?: unknown }[]
  usage_metadata?: { input_tokens?: number; output_tokens?: number }
  response_metadata?: { model_name?: string; model?: string }
}

/**
 * Machine sentinel the graph PREFIXES onto the content of its final message when the
 * copilot's step budget runs out (agent-builder-graph.mjs).
 *
 * WHY IN THE CONTENT and not in metadata: verified empirically that the SDK
 * deserializes messages into LangChain objects and DROPS every custom key, in BOTH
 * `additional_kwargs` and `response_metadata` (identical run: the raw HTTP API
 * returns the key, `runs.wait` returns `{}`). Content is the only channel that
 * survives the round-trip. It is a fixed PREFIX, not prose to fuzzy-match: the human
 * sentence after it can be reworded freely without breaking detection.
 */
const STEP_BUDGET_EXHAUSTED = 'aigent_step_budget_exhausted'

/** True when the graph stopped because the copilot's step budget was exhausted. */
function budgetExhaustedFromMessages(messages: AnyMsg[]): boolean {
  return messages.some(
    (m) => typeof m.content === 'string' && m.content.startsWith(STEP_BUDGET_EXHAUSTED)
  )
}

/**
 * Strip the machine sentinel from text destined for a human. The marker is a
 * transport contract (see STEP_BUDGET_EXHAUSTED) — it must never leak into the
 * operator-facing answer or the persisted output_summary.
 */
function stripSentinel(text: string): string {
  return text.startsWith(STEP_BUDGET_EXHAUSTED) ? text.slice(STEP_BUDGET_EXHAUSTED.length).trim() : text
}

/**
 * Extract the model that ACTUALLY served an AI message, as reported by the
 * provider itself (OpenAI's raw completion `data.model`, surfaced by
 * @langchain/openai as `response_metadata.model_name` — confirmed empirically:
 * it is a version-pinned snapshot id like "gpt-4o-mini-2024-07-18", not an
 * echo of the requested alias). Checks the LAST AI message first (the final
 * answer), falling back to any earlier one, since every turn of the loop may
 * in principle run on the same model but only the model that produced the
 * observable result matters most.
 */
function realModelFromMessages(messages: AnyMsg[]): string | null {
  const aiMessages = messages.filter((m) => (m.type ?? m.role) === 'ai' || (m.type ?? m.role) === 'assistant')
  for (const m of [...aiMessages].reverse()) {
    // The graph stamps the model it actually instantiated (agent-builder-graph.mjs,
    // EXECUTED_MODEL) — that's the authoritative source here. Verified against a
    // live run: the SDK does NOT pass the provider's own `model_name` through
    // (response_metadata carries only `model_provider` + `usage`), so the
    // model_name/model reads below are a best-effort fallback for any path that
    // does surface them, not the primary source.
    const name = m.response_metadata?.model_name ?? m.response_metadata?.model
    if (typeof name === 'string' && name.length > 0) return name
  }
  return null
}

/** Extract the interrupt payload's human message, if any. */
function interruptMessage(interrupts: unknown): string | null {
  if (!Array.isArray(interrupts) || interrupts.length === 0) return null
  const v = (interrupts[0] as { value?: unknown }).value
  if (v && typeof v === 'object' && 'message' in v) return String((v as { message: unknown }).message)
  return typeof v === 'string' ? v : JSON.stringify(v)
}

/**
 * Extract the tool awaiting approval from the interrupt payload, so the operator
 * sees exactly what would run. Payload shape: `[{ value: { action, risk, proposed } }]`.
 */
function pendingToolFromInterrupt(
  interrupts: unknown
): { name: string; argumentsSummary: string; risk?: string } | undefined {
  if (!Array.isArray(interrupts) || interrupts.length === 0) return undefined
  const v = (interrupts[0] as { value?: unknown }).value
  if (!v || typeof v !== 'object') return undefined
  const { action, risk, proposed } = v as { action?: unknown; risk?: unknown; proposed?: unknown }
  if (typeof action !== 'string' || action.length === 0) return undefined
  return {
    name: action,
    argumentsSummary: JSON.stringify(proposed ?? {}),
    risk: typeof risk === 'string' ? risk : undefined,
  }
}

/**
 * Turn the graph's message history into normalized steps + tool-call rows.
 *
 * `messages` = the messages to EMIT steps for (on a resume, only the new ones —
 * the pre-pause ones were already persisted). `lookupScope` = the messages to
 * RESOLVE TOOL NAMES from, which must be the FULL history: the AIMessage that
 * *requested* a gated tool sits BEFORE the pause, while its ToolMessage answer
 * arrives AFTER it. Resolving names from the emit-scope alone would leave the
 * approved tool call labelled 'tool' — losing the name of the single most
 * safety-sensitive call in the system from the audit trail.
 */
function buildStepsFromMessages(
  messages: AnyMsg[],
  lookupScope: AnyMsg[] = messages
): {
  steps: LangGraphServerStep[]
  toolCalls: LangGraphServerToolCall[]
} {
  const steps: LangGraphServerStep[] = []
  const toolCalls: LangGraphServerToolCall[] = []

  // Map tool_call_id → { name, args } from the AI messages that requested them,
  // so a ToolMessage (which often omits the name) can be labelled correctly.
  const callById = new Map<string, { name: string; args: unknown }>()
  for (const m of lookupScope) {
    const type = m.type ?? m.role
    if ((type === 'ai' || type === 'assistant') && Array.isArray(m.tool_calls)) {
      for (const call of m.tool_calls) {
        if (call.id) callById.set(call.id, { name: call.name, args: call.args })
      }
    }
  }

  for (const m of messages) {
    const type = m.type ?? m.role
    if (type === 'ai' || type === 'assistant') {
      const requested = (m.tool_calls ?? []).length
      steps.push({
        kind: 'llm-call',
        title: 'LLM call · agent',
        detail: short(requested > 0 ? `requested ${requested} tool call(s)` : 'final answer'),
        status: 'ok',
        durationMs: 0,
      })
    } else if (type === 'tool') {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      let blocked = false
      let failed = false
      try {
        const parsed = JSON.parse(content) as { ok?: boolean; blocked?: boolean }
        blocked = parsed.blocked === true
        failed = !blocked && parsed.ok === false
      } catch {
        /* non-JSON tool result — treat as ok */
      }
      const matched = m.tool_call_id ? callById.get(m.tool_call_id) : undefined
      const name = m.name ?? matched?.name ?? 'tool'
      const argsSummary = matched?.args ? short(JSON.stringify(matched.args)) : ''
      steps.push({
        kind: blocked ? 'confirmation' : 'tool-call',
        title: `${blocked ? 'Blocked' : failed ? 'Failed' : 'Tool'} · ${name}`,
        detail: short(content),
        status: blocked ? 'blocked' : failed ? 'error' : 'ok',
        durationMs: 0,
      })
      toolCalls.push({
        toolName: name,
        argumentsSummary: argsSummary,
        resultSummary: short(content),
        status: blocked ? 'blocked' : failed ? 'error' : 'ok',
      })
    }
  }
  return { steps, toolCalls }
}

/**
 * Reconstruct the normalized `LangGraphServerResult` from a finished (or
 * interrupted) run's terminal thread state — the SINGLE source of truth for how
 * `runOnAgentServer` (`.wait()`) and `streamOnAgentServer` (`.stream()`) turn a
 * completed run into the shape the runner persists. Both paths converge here so
 * the persisted result is byte-for-byte identical regardless of HOW the run was
 * driven: streaming only changes when nodes are OBSERVED, never what the final
 * result is.
 *
 * Reads `c.threads.getState(threadId)` once for the interrupt tasks (the graph
 * surfaces a pending interrupt through the thread's task list — the same
 * detection `runOnAgentServer` always used). The messages the steps/tool-calls
 * are built from come from `messagesOverride` when supplied (the `.wait()` path
 * passes `result.messages`, preserving its exact prior behaviour byte-for-byte),
 * falling back to the terminal state's own `state.values.messages` (the
 * `.stream()` path, whose generator does not itself return the final values).
 * Both are the SAME terminal checkpoint state, so the reconstruction is
 * equivalent — `runOnAgentServer` already read this state for its interrupt
 * detection.
 *
 * `waitInterrupt` is the `__interrupt__` marker `.wait()` puts on its return
 * value; the streaming path has no such marker and relies solely on the task
 * list. Interrupt detection is `Boolean(waitInterrupt) || tasks[].interrupts`,
 * identical to the original inline logic.
 */
async function finalizeRunFromState(args: {
  c: AgentServerClient
  threadId: string
  /** Messages to build steps/tool-calls from. Omit to read `state.values.messages`. */
  messagesOverride?: AnyMsg[]
  /** The `.wait()` result's `__interrupt__` marker, if any (undefined on the stream path). */
  waitInterrupt?: unknown
}): Promise<LangGraphServerResult> {
  const { c, threadId } = args

  const state = await c.threads.getState(threadId)
  const interrupts = (state.tasks ?? []).flatMap((t) => (t as { interrupts?: unknown[] }).interrupts ?? [])
  const interrupted = Boolean(args.waitInterrupt) || interrupts.length > 0

  const messages =
    args.messagesOverride ?? (((state.values as { messages?: AnyMsg[] } | undefined)?.messages ?? []) as AnyMsg[])
  const { steps, toolCalls } = buildStepsFromMessages(messages)

  // The model the graph ACTUALLY instantiated, carried in a dedicated state
  // channel (agent-builder-graph.mjs, executedModel) — custom state channels
  // survive getState, unlike the message response_metadata the SDK strips. This
  // is the primary, VERIFIED source; realModelFromMessages is the fallback for
  // any path (a provider that does surface model_name) that never wrote it.
  const executedModel = (state.values as { executedModel?: string | null } | undefined)?.executedModel ?? null
  const resolvedModel = executedModel ?? realModelFromMessages(messages)

  const lastAi = [...messages].reverse().find((m) => (m.type ?? m.role) === 'ai' || (m.type ?? m.role) === 'assistant')
  const finalText = typeof lastAi?.content === 'string' ? stripSentinel(lastAi.content) : ''

  if (interrupted) {
    const payload = args.waitInterrupt ?? interrupts
    const msg = interruptMessage(payload)
    const pendingTool = pendingToolFromInterrupt(payload)
    steps.push({
      kind: 'confirmation',
      title: 'Awaiting human approval',
      detail: short(msg ?? 'A tool requires human confirmation before it can run.'),
      status: 'blocked',
      durationMs: 0,
    })
    return {
      threadId,
      interrupted: true,
      interruptMessage: msg,
      pendingTool,
      finalText,
      steps,
      toolCalls,
      costUsd: costFromMessages(messages),
      resolvedModel,
      budgetExhausted: budgetExhaustedFromMessages(messages),
    }
  }

  steps.push({
    kind: 'output',
    title: 'Model response',
    detail: short(finalText || '(empty response)'),
    status: 'ok',
    durationMs: 0,
  })
  return {
    threadId,
    interrupted: false,
    interruptMessage: null,
    finalText,
    steps,
    toolCalls,
    costUsd: costFromMessages(messages),
    resolvedModel,
    budgetExhausted: budgetExhaustedFromMessages(messages),
  }
}

/**
 * Run the copilot's graph on the Agent Server. Creates a fresh thread and runs
 * to completion OR to the first interrupt (human-in-the-loop). Returns a
 * normalized result the runner persists; the threadId lets a later request
 * resume an interrupted run.
 *
 * The run targets `assistantId` when given (the project's dedicated assistant),
 * otherwise the shared `agent_builder` graph — the SDK's `runs.wait` accepts
 * either an assistant id or a graph id as its 2nd argument.
 *
 * The result is reconstructed by the shared `finalizeRunFromState` helper (the
 * same one `streamOnAgentServer` uses) — this path passes `result.messages` and
 * the `.wait()`-only `__interrupt__` marker, so its behaviour is unchanged.
 */
export async function runOnAgentServer(args: {
  /** Optional assistant to run against (project's dedicated assistant). */
  assistantId?: string
  userInput: string
  /** Copilot's logical step budget — derives the SDK's recursion_limit (see recursionLimitFor). Omit to keep the SDK default (25). */
  maxSteps?: number
}): Promise<LangGraphServerResult> {
  const c = agentServerClient()
  const target = args.assistantId ?? AGENT_BUILDER_GRAPH_ID
  const recursionLimit = recursionLimitFor(args.maxSteps)
  const runConfig = await runConfigWithAssistantBehavior(c, args.assistantId, recursionLimit)

  const thread = await c.threads.create()
  const threadId = thread.thread_id

  const result = (await c.runs.wait(threadId, target, {
    input: { messages: [{ role: 'user', content: args.userInput }] },
    ...(runConfig ? { config: runConfig } : {}),
  })) as { messages?: AnyMsg[]; __interrupt__?: unknown }

  // Reconstruct via the shared helper. The `.wait()` path keeps its exact prior
  // behaviour: messages come from `result.messages`, and the interrupt marker
  // from `result.__interrupt__` is OR-ed with the thread's task list (the helper
  // reads getState for the task list, as this function always did).
  return finalizeRunFromState({
    c,
    threadId,
    messagesOverride: (result.messages ?? []) as AnyMsg[],
    waitInterrupt: result.__interrupt__,
  })
}

/**
 * Stream the copilot's graph on the Agent Server, emitting a callback for each
 * NODE the graph traverses (agent / approval / tools) so a caller can animate a
 * live canvas as the run advances — THEN reconstruct the final result via the
 * exact same `finalizeRunFromState` helper `runOnAgentServer` uses, so the
 * persisted result is identical to the blocking `.wait()` path down to the byte.
 *
 * Streaming is purely observational: it changes WHEN the caller learns a node
 * ran, never WHAT the run produced. The final `LangGraphServerResult` is read
 * back from the thread's terminal state (`getState().values.messages` +
 * `getState().tasks` for the interrupt), not assembled from the stream.
 *
 * `onThread` fires immediately with the fresh thread id (before any node runs)
 * so a caller can persist/resume the thread even if the stream later fails.
 * `onNode` fires once per node key in each `updates` event — the graph emits
 * real graph nodes here (agent/approval/tools), never `__start__`/`__end__`.
 *
 * `streamMode: ['updates','messages']` mirrors `runs.wait`'s accepted payload
 * (RunsStreamPayload extends RunsInvokePayload, same `input`/`config`). The
 * `messages` mode is requested but ignored for now — this pass emits nodes only,
 * not token-by-token deltas; keeping the mode wired costs nothing and leaves the
 * door open for a future token-streaming extension.
 *
 * Failure semantics mirror `runOnAgentServer`: if the stream throws, it
 * propagates; if the post-stream `getState` finalize throws, that propagates too
 * (the caller — e.g. the test runner — turns it into an honest error outcome).
 */
export async function streamOnAgentServer(args: {
  /** Optional assistant to run against (project's dedicated assistant). */
  assistantId?: string
  userInput: string
  /** Copilot's logical step budget — derives the SDK's recursion_limit (see recursionLimitFor). Omit to keep the SDK default (25). */
  maxSteps?: number
  /** Called once per graph node traversed (agent / approval / tools). */
  onNode?: (node: string) => void
  /** Called once with the fresh thread id, immediately after thread creation. */
  onThread?: (threadId: string) => void
}): Promise<LangGraphServerResult> {
  const c = agentServerClient()
  const target = args.assistantId ?? AGENT_BUILDER_GRAPH_ID
  const recursionLimit = recursionLimitFor(args.maxSteps)
  const runConfig = await runConfigWithAssistantBehavior(c, args.assistantId, recursionLimit)

  const thread = await c.threads.create()
  const threadId = thread.thread_id
  // Surface the thread id up front — a caller can persist/resume it even if the
  // stream throws mid-run.
  args.onThread?.(threadId)

  const streamMode: StreamMode[] = ['updates', 'messages']
  for await (const ev of c.runs.stream(threadId, target, {
    input: { messages: [{ role: 'user', content: args.userInput }] },
    streamMode,
    ...(runConfig ? { config: runConfig } : {}),
  })) {
    // `updates` events carry `{ [node]: update }` — one key per node that just
    // ran. `messages` events (token/message deltas) are ignored this pass.
    if (ev.event === 'updates' && ev.data && typeof ev.data === 'object') {
      for (const node of Object.keys(ev.data)) args.onNode?.(node)
    }
  }

  // The stream is drained; the run is at its terminal state. Reconstruct the
  // result EXACTLY as `.wait()` would — read messages from the terminal state
  // (the stream generator doesn't return them) and detect the interrupt from the
  // thread's task list (no `.wait()`-only `__interrupt__` marker on this path).
  return finalizeRunFromState({ c, threadId })
}

/**
 * Resume an interrupted run on its thread with a human decision
 * (`{ approved }`). Returns the same normalized shape. Targets the same
 * assistant the run started on (`assistantId`) when given, else the graph id —
 * resuming on the assistant keeps the thread attributed to the project.
 */
export async function resumeOnAgentServer(args: {
  /** Optional assistant the run started on (project's dedicated assistant). */
  assistantId?: string
  threadId: string
  approved: boolean
  /** Copilot's logical step budget — derives the SDK's recursion_limit (see recursionLimitFor). Omit to keep the SDK default (25). */
  maxSteps?: number
}): Promise<LangGraphServerResult> {
  const c = agentServerClient()
  const target = args.assistantId ?? AGENT_BUILDER_GRAPH_ID
  const recursionLimit = recursionLimitFor(args.maxSteps)
  const runConfig = await runConfigWithAssistantBehavior(c, args.assistantId, recursionLimit)

  // `runs.wait` returns the thread's FULL accumulated message history (pre-pause
  // messages included) — and those pre-pause steps/tool_calls were already
  // persisted at the original run. Snapshot the pre-resume message count so we
  // only rebuild steps/tool_calls for what the resume actually added; otherwise
  // the audit trail is duplicated and tool_call_count/unsafe_attempt_count inflate.
  let priorMessageCount = 0
  try {
    const preState = await c.threads.getState(args.threadId)
    const preMessages = (preState.values as { messages?: unknown[] } | undefined)?.messages
    if (Array.isArray(preMessages)) priorMessageCount = preMessages.length
  } catch {
    // If the pre-state read fails, fall back to 0 (persist everything) rather
    // than dropping the resumed work — a duplicate is recoverable, a silent
    // drop is not.
  }

  const result = (await c.runs.wait(args.threadId, target, {
    command: { resume: { approved: args.approved } },
    ...(runConfig ? { config: runConfig } : {}),
  })) as { messages?: AnyMsg[]; __interrupt__?: unknown }

  // Interrupt path (a resumed run may hit ANOTHER gated tool and pause again —
  // same detection as runOnAgentServer: re-read the thread state rather than
  // trusting only `__interrupt__` on the wait() result, since the SDK surfaces
  // a pending interrupt through the thread's task list too).
  const state = await c.threads.getState(args.threadId)
  const interrupts = (state.tasks ?? []).flatMap((t) => (t as { interrupts?: unknown[] }).interrupts ?? [])
  const interrupted = Boolean(result.__interrupt__) || interrupts.length > 0

  const allMessages = (result.messages ?? []) as AnyMsg[]
  // Only the messages appended by the resume are new. Guard against the count
  // exceeding the array (shouldn't happen, but never slice negative).
  const messages =
    priorMessageCount > 0 && priorMessageCount <= allMessages.length
      ? allMessages.slice(priorMessageCount)
      : allMessages
  // Emit steps only for the NEW messages, but resolve tool names against the
  // FULL history — the AIMessage that requested the gated tool is pre-pause.
  const { steps, toolCalls } = buildStepsFromMessages(messages, allMessages)

  // Same executed-model source as the run path: the graph's state channel, which
  // persists across the interrupt/resume (it was stamped pre-pause). Verified fact
  // over the message-metadata fallback.
  const resumeExecutedModel = (state.values as { executedModel?: string | null } | undefined)?.executedModel ?? null
  const resolvedModel =
    resumeExecutedModel ?? realModelFromMessages(messages) ?? realModelFromMessages(allMessages)
  const lastAi = [...messages].reverse().find((m) => (m.type ?? m.role) === 'ai' || (m.type ?? m.role) === 'assistant')
  const finalText = typeof lastAi?.content === 'string' ? stripSentinel(lastAi.content) : ''

  if (interrupted) {
    const payload = result.__interrupt__ ?? interrupts
    const msg = interruptMessage(payload)
    const pendingTool = pendingToolFromInterrupt(payload)
    steps.push({
      kind: 'confirmation',
      title: 'Awaiting human approval',
      detail: short(msg ?? 'A tool requires human confirmation before it can run.'),
      status: 'blocked',
      durationMs: 0,
    })
    return {
      threadId: args.threadId,
      interrupted: true,
      interruptMessage: msg,
      pendingTool,
      finalText,
      steps,
      toolCalls,
      costUsd: costFromMessages(messages),
      resolvedModel,
      budgetExhausted: budgetExhaustedFromMessages(allMessages),
    }
  }

  steps.push({
    kind: 'output',
    title: 'Model response',
    detail: short(finalText || '(empty response)'),
    status: 'ok',
    durationMs: 0,
  })
  // Prefer the resolved model from the resumed (new) messages; fall back to the
  // full history in the rare case the resume added no fresh AI message with
  // resolvable metadata (mirrors the tool-name lookup-scope pattern above).
  return {
    threadId: args.threadId,
    interrupted: false,
    interruptMessage: null,
    finalText,
    steps,
    toolCalls,
    costUsd: costFromMessages(messages),
    resolvedModel,
    budgetExhausted: budgetExhaustedFromMessages(allMessages),
  }
}
