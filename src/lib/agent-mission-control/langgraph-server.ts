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

import { agentServerClient, AGENT_BUILDER_GRAPH_ID } from './langgraph-client'
import { computeCostUsd, estimateTokens } from './model-pricing'
import type { DurationMs } from './types'

// Re-export so existing importers of the graph id keep a stable path.
export { AGENT_BUILDER_GRAPH_ID } from './langgraph-client'

/** The model the Agent Server graph runs on (mirrors AGENT_BUILDER_MODEL). */
function graphModel(): string {
  return process.env.AGENT_BUILDER_MODEL || 'gpt-5.4'
}

/**
 * Sum the run's USD cost from the AI messages' usage_metadata. The graph runs
 * on OpenAI (graphModel), so cost is normalized via model-pricing. When a
 * message lacks usage, its tokens are estimated from content — never NaN,
 * never silently zero (unlike the previous hardcoded 0).
 */
function costFromMessages(messages: AnyMsg[]): number {
  const model = graphModel()
  let total = 0
  for (const m of messages) {
    const type = m.type ?? m.role
    if (type !== 'ai' && type !== 'assistant') continue
    const usage = m.usage_metadata
    const inTok = usage?.input_tokens ?? 0
    const outTok = usage?.output_tokens ?? estimateTokens(String(m.content ?? ''))
    total += computeCostUsd('openai', model, inTok, outTok)
  }
  return Math.round(total * 1e6) / 1e6
}

export interface LangGraphServerStep {
  kind: 'llm-call' | 'tool-call' | 'guardrail-check' | 'confirmation' | 'output'
  title: string
  detail: string
  status: 'ok' | 'warning' | 'blocked' | 'error'
  durationMs: DurationMs
}

export interface LangGraphServerToolCall {
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
  costUsd: number
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
 * Budget = NODES_PER_STEP × maxSteps + 1 (the final agent turn), floored at the
 * SDK default so we never constrain a run tighter than the out-of-the-box 25,
 * and capped so a misconfigured maxSteps can't run unbounded. Returns undefined
 * when maxSteps is undefined (or not a finite number) so callers keep the SDK
 * default unchanged.
 */
function recursionLimitFor(maxSteps: number | undefined): number | undefined {
  if (maxSteps === undefined || !Number.isFinite(maxSteps)) return undefined
  const derived = Math.max(1, Math.floor(maxSteps)) * NODES_PER_STEP + 1
  return Math.min(Math.max(derived, SDK_DEFAULT_RECURSION_LIMIT), RECURSION_LIMIT_CAP)
}

type AnyMsg = {
  type?: string
  role?: string
  content?: unknown
  name?: string
  tool_call_id?: string
  tool_calls?: { id?: string; name: string; args?: unknown }[]
  usage_metadata?: { input_tokens?: number; output_tokens?: number }
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

/** Turn the graph's message history into normalized steps + tool-call rows. */
function buildStepsFromMessages(messages: AnyMsg[]): {
  steps: LangGraphServerStep[]
  toolCalls: LangGraphServerToolCall[]
} {
  const steps: LangGraphServerStep[] = []
  const toolCalls: LangGraphServerToolCall[] = []

  // Map tool_call_id → { name, args } from the AI messages that requested them,
  // so a ToolMessage (which often omits the name) can be labelled correctly.
  const callById = new Map<string, { name: string; args: unknown }>()
  for (const m of messages) {
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
      try {
        const parsed = JSON.parse(content) as { ok?: boolean; blocked?: boolean }
        blocked = parsed.blocked === true || parsed.ok === false
      } catch {
        /* non-JSON tool result — treat as ok */
      }
      const matched = m.tool_call_id ? callById.get(m.tool_call_id) : undefined
      const name = m.name ?? matched?.name ?? 'tool'
      const argsSummary = matched?.args ? short(JSON.stringify(matched.args)) : ''
      steps.push({
        kind: blocked ? 'confirmation' : 'tool-call',
        title: `${blocked ? 'Blocked' : 'Tool'} · ${name}`,
        detail: short(content),
        status: blocked ? 'blocked' : 'ok',
        durationMs: 0,
      })
      toolCalls.push({
        toolName: name,
        argumentsSummary: argsSummary,
        resultSummary: short(content),
        status: blocked ? 'blocked' : 'ok',
      })
    }
  }
  return { steps, toolCalls }
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

  const thread = await c.threads.create()
  const threadId = thread.thread_id

  const result = (await c.runs.wait(threadId, target, {
    input: { messages: [{ role: 'user', content: args.userInput }] },
    ...(recursionLimit !== undefined ? { config: { recursion_limit: recursionLimit } } : {}),
  })) as { messages?: AnyMsg[]; __interrupt__?: unknown }

  // Interrupt path (write/confirm tool paused for approval).
  const state = await c.threads.getState(threadId)
  const interrupts = (state.tasks ?? []).flatMap((t) => (t as { interrupts?: unknown[] }).interrupts ?? [])
  const interrupted = Boolean(result.__interrupt__) || interrupts.length > 0

  const messages = (result.messages ?? []) as AnyMsg[]
  const { steps, toolCalls } = buildStepsFromMessages(messages)

  const lastAi = [...messages].reverse().find((m) => (m.type ?? m.role) === 'ai' || (m.type ?? m.role) === 'assistant')
  const finalText = typeof lastAi?.content === 'string' ? lastAi.content : ''

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
    return { threadId, interrupted: true, interruptMessage: msg, pendingTool, finalText, steps, toolCalls, costUsd: costFromMessages(messages) }
  }

  steps.push({
    kind: 'output',
    title: 'Model response',
    detail: short(finalText || '(empty response)'),
    status: 'ok',
    durationMs: 0,
  })
  return { threadId, interrupted: false, interruptMessage: null, finalText, steps, toolCalls, costUsd: costFromMessages(messages) }
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
    ...(recursionLimit !== undefined ? { config: { recursion_limit: recursionLimit } } : {}),
  })) as { messages?: AnyMsg[]; __interrupt__?: unknown }

  const allMessages = (result.messages ?? []) as AnyMsg[]
  // Only the messages appended by the resume are new. Guard against the count
  // exceeding the array (shouldn't happen, but never slice negative).
  const messages =
    priorMessageCount > 0 && priorMessageCount <= allMessages.length
      ? allMessages.slice(priorMessageCount)
      : allMessages
  const { steps, toolCalls } = buildStepsFromMessages(messages)
  const lastAi = [...messages].reverse().find((m) => (m.type ?? m.role) === 'ai' || (m.type ?? m.role) === 'assistant')
  const finalText = typeof lastAi?.content === 'string' ? lastAi.content : ''

  steps.push({
    kind: 'output',
    title: 'Model response',
    detail: short(finalText || '(empty response)'),
    status: 'ok',
    durationMs: 0,
  })
  return { threadId: args.threadId, interrupted: false, interruptMessage: null, finalText, steps, toolCalls, costUsd: costFromMessages(messages) }
}
