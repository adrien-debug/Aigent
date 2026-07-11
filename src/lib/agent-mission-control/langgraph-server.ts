/**
 * Agent Mission Control — LangGraph Agent Server client (server only).
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
 * Env: LANGGRAPH_API_URL (default http://127.0.0.1:2024), and the server itself
 * reads OPENAI_API_KEY + the gpu1 perimeter from .env.local.
 */
import 'server-only'

import { Client } from '@langchain/langgraph-sdk'

import type { DurationMs } from './types'

/** Base URL of the local Agent Server (overridable for a remote deployment). */
export function agentServerUrl(): string {
  return process.env.LANGGRAPH_API_URL || 'http://127.0.0.1:2024'
}

const client = (): Client => new Client({ apiUrl: agentServerUrl() })

/** Graph id declared in langgraph.json. */
export const AGENT_BUILDER_GRAPH_ID = 'agent_builder'

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
 */
export async function runOnAgentServer(args: {
  graphId?: string
  userInput: string
}): Promise<LangGraphServerResult> {
  const c = client()
  const graphId = args.graphId ?? AGENT_BUILDER_GRAPH_ID

  const thread = await c.threads.create()
  const threadId = thread.thread_id

  const result = (await c.runs.wait(threadId, graphId, {
    input: { messages: [{ role: 'user', content: args.userInput }] },
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
    return { threadId, interrupted: true, interruptMessage: msg, pendingTool, finalText, steps, toolCalls, costUsd: 0 }
  }

  steps.push({
    kind: 'output',
    title: 'Model response',
    detail: short(finalText || '(empty response)'),
    status: 'ok',
    durationMs: 0,
  })
  return { threadId, interrupted: false, interruptMessage: null, finalText, steps, toolCalls, costUsd: 0 }
}

/**
 * Resume an interrupted run on its thread with a human decision
 * (`{ approved }`). Returns the same normalized shape.
 */
export async function resumeOnAgentServer(args: {
  graphId?: string
  threadId: string
  approved: boolean
}): Promise<LangGraphServerResult> {
  const c = client()
  const graphId = args.graphId ?? AGENT_BUILDER_GRAPH_ID

  const result = (await c.runs.wait(args.threadId, graphId, {
    command: { resume: { approved: args.approved } },
  })) as { messages?: AnyMsg[]; __interrupt__?: unknown }

  const messages = (result.messages ?? []) as AnyMsg[]
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
  return { threadId: args.threadId, interrupted: false, interruptMessage: null, finalText, steps, toolCalls, costUsd: 0 }
}
