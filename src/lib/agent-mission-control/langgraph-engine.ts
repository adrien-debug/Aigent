/**
 * Agent Mission Control — LangGraph execution engine (server only).
 *
 * A REAL LangGraph runtime (not a label): a StateGraph with an `agent` node
 * (ChatOpenAI bound to the copilot's tools) and a `tools` node (our real
 * TOOL_HANDLERS, wrapped as LangChain tools with the confirmation gate). The
 * graph loops agent → tools → agent until the model answers or the manifest
 * step budget is hit — the canonical LangGraph agent loop, driven by
 * `toolsCondition`.
 *
 * It is selected by the shared runner when `copilot.runtime === 'langgraph'`.
 * It returns the SAME step/tool-call/cost shape the runner persists, so a
 * LangGraph run lands in agent_runs / agent_run_steps / tool_calls exactly
 * like the direct-OpenAI path — no special-casing downstream.
 *
 * Requires OPENAI_API_KEY (LangGraph's model calls go through ChatOpenAI).
 * Never import from a client component.
 */
import 'server-only'

import { ToolMessage } from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import { ChatOpenAI } from '@langchain/openai'
import { END, START, MessagesAnnotation, StateGraph } from '@langchain/langgraph'
import { z } from 'zod'

import { computeCostUsd, estimateTokens } from './model-pricing'
import { TOOL_HANDLERS } from './tool-handlers'
import type { DurationMs, IsoTimestamp, ModelProvider } from './types'
import type { RunnerTool } from './runner'

// ---------------------------------------------------------------------------
// Engine step shape — mirrors what the runner persists (trace kinds + tool rows).
// ---------------------------------------------------------------------------

export interface EngineStep {
  kind: 'llm-call' | 'tool-call' | 'guardrail-check' | 'confirmation' | 'output'
  title: string
  detail: string
  status: 'ok' | 'warning' | 'blocked' | 'error'
  durationMs: DurationMs
  toolCallId: string | null
}

export interface EngineToolCallRow {
  toolId: string | null
  toolName: string
  argumentsSummary: string
  resultSummary: string
  status: 'ok' | 'error' | 'blocked' | 'rejected'
  riskLevel: RunnerTool['riskLevel']
  requiredConfirmation: boolean
  latencyMs: DurationMs
}

export interface LangGraphRunResult {
  finalText: string
  steps: EngineStep[]
  toolCallRows: EngineToolCallRow[]
  toolCallCount: number
  blockedToolCount: number
  costUsd: number
  resolvedProvider: ModelProvider
  resolvedModel: string
}

export interface RunLangGraphArgs {
  copilotId: string
  model: string
  systemPromptSummary: string
  userInput: string
  maxSteps: number
  tools: RunnerTool[]
  confirmedToolNames: Set<string>
}

const short = (s: string, n = 300): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * Execute one copilot run through a real LangGraph StateGraph.
 *
 * The confirmation gate lives inside the wrapped tools: a tool with
 * requiresConfirmation that is not in `confirmedToolNames` NEVER runs its
 * handler — it returns a blocked result (and the step/tool-row reflect it),
 * so a write/risky tool cannot fire without human approval even under
 * LangGraph's autonomous loop.
 */
export async function runLangGraph(args: RunLangGraphArgs): Promise<LangGraphRunResult> {
  const { copilotId, model, systemPromptSummary, userInput, maxSteps, tools, confirmedToolNames } = args

  const steps: EngineStep[] = []
  const toolCallRows: EngineToolCallRow[] = []
  let costUsd = 0
  let toolCallCount = 0
  let blockedToolCount = 0
  let llmTurns = 0

  const resolvedModel = model || 'gpt-5.4'

  // Resolve-model step (parity with the direct runner's first step).
  steps.push({
    kind: 'guardrail-check',
    title: 'Resolve model',
    detail: `LangGraph runtime · openai/${resolvedModel} · ${tools.length} tool${tools.length === 1 ? '' : 's'} available.`,
    status: 'ok',
    durationMs: 0,
    toolCallId: null,
  })

  // Wrap each manifest tool as a LangChain tool, applying the confirmation gate
  // and recording a step + tool-row per invocation. A permissive object schema
  // matches the runner's stance (handlers parse args defensively).
  const lcTools = tools
    .filter((t) => TOOL_HANDLERS[t.name])
    .map((t) =>
      tool(
        async (input: Record<string, unknown>) => {
          toolCallCount += 1
          const argsJson = JSON.stringify(input ?? {})

          // Confirmation gate — a requiresConfirmation tool is blocked unless
          // the caller confirmed it. The handler is never invoked.
          if (t.requiresConfirmation && !confirmedToolNames.has(t.name)) {
            blockedToolCount += 1
            const reason = `tool '${t.name}' requires human confirmation (${t.riskLevel} risk) — blocked pending approval`
            steps.push({
              kind: 'confirmation',
              title: `Blocked · ${t.name}`,
              detail: short(reason),
              status: 'blocked',
              durationMs: 0,
              toolCallId: null,
            })
            toolCallRows.push({
              toolId: t.id,
              toolName: t.name,
              argumentsSummary: short(argsJson),
              resultSummary: short(reason),
              status: 'blocked',
              riskLevel: t.riskLevel,
              requiredConfirmation: true,
              latencyMs: 0,
            })
            return JSON.stringify({ ok: false, blocked: true, reason })
          }

          // Allowed → run the real handler.
          const start = Date.now()
          const result = await TOOL_HANDLERS[t.name](argsJson, { copilotId })
          const latency = Date.now() - start
          steps.push({
            kind: 'tool-call',
            title: `Tool · ${t.name}`,
            detail: short(result.summary),
            status: result.ok ? 'ok' : 'error',
            durationMs: latency,
            toolCallId: null,
          })
          toolCallRows.push({
            toolId: t.id,
            toolName: t.name,
            argumentsSummary: short(argsJson),
            resultSummary: short(result.summary),
            status: result.ok ? 'ok' : 'error',
            riskLevel: t.riskLevel,
            requiredConfirmation: t.requiresConfirmation,
            latencyMs: latency,
          })
          return JSON.stringify({ ok: result.ok, data: result.data })
        },
        {
          name: t.name,
          description: t.description,
          schema: z.object({}).passthrough(),
        }
      )
    )

  const llm = new ChatOpenAI({ model: resolvedModel, apiKey: process.env.OPENAI_API_KEY })
  const llmWithTools = lcTools.length > 0 ? llm.bindTools(lcTools) : llm

  // The agent node: one model turn. Records an llm-call step + accrues cost.
  async function agentNode(state: typeof MessagesAnnotation.State) {
    llmTurns += 1
    const start = Date.now()
    const response = await llmWithTools.invoke(state.messages)
    const latency = Date.now() - start

    // Cost from usage metadata when present, else a token estimate (never NaN).
    const usage = (response as { usage_metadata?: { input_tokens?: number; output_tokens?: number } }).usage_metadata
    const inTok = usage?.input_tokens ?? estimateTokens(state.messages.map((m) => String(m.content)).join(' '))
    const outTok = usage?.output_tokens ?? estimateTokens(String(response.content ?? ''))
    costUsd += computeCostUsd('openai', resolvedModel, inTok, outTok)

    const requested = (response.tool_calls ?? []).length
    steps.push({
      kind: 'llm-call',
      title: `LLM call · openai/${resolvedModel}`,
      detail: short(`turn ${llmTurns} · in ${inTok} tok, out ${outTok} tok, ${requested > 0 ? `${requested} tool call(s)` : 'final'}`),
      status: 'ok',
      durationMs: latency,
      toolCallId: null,
    })
    return { messages: [response] }
  }

  // The tools node: run every tool call the model requested (through our wrapped
  // tools, so the gate + recording fire). Returns ToolMessages for the next turn.
  async function toolsNode(state: typeof MessagesAnnotation.State) {
    const last = state.messages[state.messages.length - 1] as {
      tool_calls?: { id?: string; name: string; args: Record<string, unknown> }[]
    }
    const calls = last.tool_calls ?? []
    const toolMessages: ToolMessage[] = []
    for (const call of calls) {
      const lc = lcTools.find((x) => x.name === call.name)
      const content = lc
        ? await lc.invoke(call.args ?? {})
        : JSON.stringify({ ok: false, reason: `tool '${call.name}' not in manifest allowlist` })
      if (!lc) {
        // Unknown tool requested — record a denial (not blocked, just refused).
        steps.push({
          kind: 'guardrail-check',
          title: `Denied · ${call.name}`,
          detail: short(`tool '${call.name}' is not in the manifest allowlist`),
          status: 'blocked',
          durationMs: 0,
          toolCallId: null,
        })
      }
      toolMessages.push(
        new ToolMessage({ content: String(content), tool_call_id: call.id ?? call.name })
      )
    }
    return { messages: toolMessages }
  }

  // Route from the agent: if the last message requested tools → tools node, else END.
  // Also hard-stop at the manifest step budget (maxSteps model turns).
  function routeAgent(state: typeof MessagesAnnotation.State): 'tools' | typeof END {
    if (llmTurns >= Math.max(1, maxSteps)) return END
    const last = state.messages[state.messages.length - 1] as { tool_calls?: unknown[] }
    return (last.tool_calls ?? []).length > 0 ? 'tools' : END
  }

  const graph = new StateGraph(MessagesAnnotation)
    .addNode('agent', agentNode)
    .addNode('tools', toolsNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', routeAgent, ['tools', END])
    .addEdge('tools', 'agent')
    .compile()

  const finalState = await graph.invoke({
    messages: [
      { role: 'system', content: systemPromptSummary },
      { role: 'user', content: userInput },
    ],
    // Guard against pathological loops beyond the step budget.
  }, { recursionLimit: Math.max(4, maxSteps * 2 + 2) })

  // The final answer is the content of the last AI message.
  const finalMessages = finalState.messages
  const finalText = String(finalMessages[finalMessages.length - 1]?.content ?? '').trim()

  steps.push({
    kind: 'output',
    title: 'Model response',
    detail: short(finalText || '(empty response)'),
    status: 'ok',
    durationMs: 0,
    toolCallId: null,
  })

  return {
    finalText,
    steps,
    toolCallRows,
    toolCallCount,
    blockedToolCount,
    costUsd: Math.round(costUsd * 1e6) / 1e6,
    resolvedProvider: 'openai',
    resolvedModel,
  }
}

/** Stamp an ISO time — small helper kept here so callers don't import Date logic. */
export function nowIso(): IsoTimestamp {
  return new Date().toISOString()
}
