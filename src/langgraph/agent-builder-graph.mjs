/**
 * Agent Builder Copilot — LangGraph graph for the LangGraph Agent Server.
 *
 * This is a REAL, standard LangGraph graph (StateGraph compiled + exported),
 * loaded by `langgraphjs dev` (the official Agent Server) and visualised /
 * debugged in LangSmith Studio. The server owns checkpointing, streaming,
 * interrupt/resume and thread state — we only declare the graph.
 *
 * Shape: agent (ChatOpenAI bound to tools) ↔ tools. Read-only tools execute
 * against the live gpu1 perimeter. A write / confirmation-required tool calls
 * `interrupt()` — the graph PAUSES and the server surfaces it for human
 * approval; a `Command({ resume: { approved } })` continues it. This is the
 * canonical human-in-the-loop pattern, provided by the runtime, not hand-rolled.
 *
 * PARAMETRIC BY COPILOT: the platform now runs ONE assistant PER COPILOT. Each
 * assistant carries a CopilotBehaviorConfig in `config.configurable` (see
 * ASSISTANT_CONFIG_CONTRACT): its system prompt, model, maxSteps, and the exact
 * set of REAL tools (with per-copilot scope + gating). The nodes read that
 * config at RUNTIME (2nd arg) — nothing behavioural is hard-coded on the
 * configured path. The model is instantiated PER RUN from `cfg.model`, so one
 * compiled graph serves every copilot.
 *
 * LEGACY FALLBACK: if `config.configurable` is absent (an assistant created
 * without config, or a run against the graph id directly), the nodes fall back
 * to the EXACT previous behaviour — the hard-coded SYSTEM_PROMPT, the 5 generic
 * tools, and CONFIRM_REQUIRED = { draft_copilot_spec } — so nothing breaks.
 *
 * Exports `graph` (the compiled graph) — referenced by langgraph.json.
 */
import { ChatOpenAI } from '@langchain/openai'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import { StateGraph, MessagesAnnotation, START, END, interrupt } from '@langchain/langgraph'

import { buildTool, buildToolsFromConfig } from './tool-registry.mjs'

// ---------------------------------------------------------------------------
// LEGACY DEFAULTS — the exact pre-config behaviour, used ONLY as fallback when
// `config.configurable` is absent. Kept verbatim so legacy copilots (assistant
// without config, or run via the graph id) behave EXACTLY as before.
// ---------------------------------------------------------------------------

// The 5 generic tools that were hard-coded in the graph. Built THROUGH the
// registry (single source of truth for the impls) with no scope — repo/http
// tools aren't in this legacy set, so scope is irrelevant here.
const DEFAULT_TOOL_IDS = [
  'read_project_summary',
  'read_copilot_summary',
  'read_recent_runs',
  'read_tool_permissions',
  'draft_copilot_spec',
]

// Tools requiring human approval before they run, in the legacy set. (Only the
// write tool.) On the CONFIGURED path this is derived from the config instead.
const DEFAULT_CONFIRM_REQUIRED = new Set(['draft_copilot_spec'])
const DEFAULT_TOOL_RISK = { draft_copilot_spec: 'medium' }

const DEFAULT_MODEL = process.env.AGENT_BUILDER_MODEL || 'gpt-5.4'

const DEFAULT_SYSTEM_PROMPT = [
  'You are Agent Builder Copilot, an internal assistant for Agent Mission Control.',
  'You help operators design and prepare FUTURE copilots — safely and controllably.',
  'You CAN read existing projects/copilots/runs/tool-permissions and draft specs, manifests, tools and tests.',
  // Spell out the list-vs-one behaviour: the model previously refused to list/count
  // copilots because it assumed an id was required. It is not — calling with no arg lists all.
  'To enumerate or COUNT things, call the read tool with NO argument: read_project_summary lists all projects, read_copilot_summary lists all copilots, read_recent_runs returns recent runs across all copilots. Pass an id only to narrow to one. (read_tool_permissions is the exception: it REQUIRES a copilotId.)',
  'You CANNOT auto-promote to production, push to external repos, create unconfirmed write tools, or bypass approval.',
  'Prefer least-privilege, read-only proposals. When an action needs confirmation, the tool will pause for human approval.',
  // Keep drafts on-platform: the runtime is 'langgraph' and the default model is 'gpt-5.4'.
  "When drafting a copilot, prefer runtime 'langgraph' and model 'gpt-5.4' (the platform defaults). Do NOT propose 'default' as a runtime or legacy models like 'gpt-4.1'.",
].join('\n')

// ---------------------------------------------------------------------------
// Runtime resolution — turn `config.configurable` into everything a node needs.
// One place that decides configured-vs-legacy, so all three nodes agree.
// ---------------------------------------------------------------------------

/**
 * Resolve the effective behaviour for THIS run from the LangGraph config.
 * @param {import('@langchain/langgraph').LangGraphRunnableConfig} [config]
 * @returns {{ systemPrompt:string, model:string, maxSteps:number, tools:any[], toolsByName:Record<string,any>, confirmRequired:Set<string>, toolRisk:Record<string,string> }}
 */
function resolveRuntime(config) {
  const cfg = config?.configurable ?? {}
  // A config is "present" once it names either tools or a system prompt — that's
  // what ensureCopilotAssistant writes. Otherwise fall back to legacy defaults.
  const hasConfig = Array.isArray(cfg.tools) || typeof cfg.systemPrompt === 'string'

  if (!hasConfig) {
    // LEGACY PATH — exact previous behaviour, tools built through the registry.
    const tools = DEFAULT_TOOL_IDS.map((id) => buildTool(id)).filter(Boolean)
    return {
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      model: DEFAULT_MODEL,
      maxSteps: 12,
      tools,
      toolsByName: Object.fromEntries(tools.map((t) => [t.name, t])),
      confirmRequired: DEFAULT_CONFIRM_REQUIRED,
      toolRisk: DEFAULT_TOOL_RISK,
    }
  }

  // CONFIGURED PATH — everything derived from the CopilotBehaviorConfig.
  const { tools, confirmRequired, toolRisk } = buildToolsFromConfig(cfg.tools ?? [])
  return {
    systemPrompt: typeof cfg.systemPrompt === 'string' && cfg.systemPrompt.trim() ? cfg.systemPrompt : DEFAULT_SYSTEM_PROMPT,
    model: typeof cfg.model === 'string' && cfg.model.trim() ? cfg.model : DEFAULT_MODEL,
    maxSteps: Number.isFinite(cfg.maxSteps) ? cfg.maxSteps : 12,
    tools,
    toolsByName: Object.fromEntries(tools.map((t) => [t.name, t])),
    confirmRequired,
    toolRisk,
  }
}

// ---------------------------------------------------------------------------
// Nodes — each takes (state, config) and reads `config.configurable` at runtime.
// ---------------------------------------------------------------------------

/**
 * Count completed agent turns from the STATE itself (never a module-level
 * variable — the compiled graph is a singleton shared by every copilot/run,
 * so any counter that lived outside `state` would be shared/racy across
 * concurrent runs and across resumes of the same run). Each pass through
 * agentNode appends exactly one AI message, so "number of AI messages already
 * in state" IS "number of agent turns already taken" — a pure function of the
 * checkpointed state, so it's correct on first run, on tool-loop continuation,
 * and on interrupt/resume alike (the paused/resumed state still carries every
 * prior AI message).
 * @param {import('@langchain/langgraph').BaseMessage[]} messages
 */
function countAgentTurns(messages) {
  return messages.filter((m) => (m.getType?.() ?? m.type) === 'ai').length
}

async function agentNode(state, config) {
  const rt = resolveRuntime(config)

  // Step-budget guard (defense in depth): `runOnAgentServer` derives its own
  // `recursion_limit` from this SAME `maxSteps` and passes it to the SDK, but
  // that only protects callers who go through it. Anything that invokes this
  // graph directly (LangSmith Studio, a bare SDK call, a future script) skips
  // that layer entirely and would otherwise fall back to the framework's
  // generic recursion_limit default — silently NOT honouring the copilot's
  // configured budget. So the graph enforces its own turn count too, from
  // state, independent of who's calling it.
  const turnsTaken = countAgentTurns(state.messages)
  if (turnsTaken >= rt.maxSteps) {
    return {
      messages: [
        new AIMessage(
          'I stopped here: this copilot’s step budget (maxSteps) is exhausted, so I could not finish the task. ' +
            'Please start a new run or narrow the request so it fits within the remaining steps.',
        ),
      ],
    }
  }

  // Instantiate the model PER RUN from the config — one compiled graph serves
  // every copilot's model. parallel_tool_calls:false → ONE tool per turn, which
  // keeps the approval gate deterministic (a gated tool is never batched behind
  // read tools, so the pause lands cleanly on a single call).
  const modelWithTools = new ChatOpenAI({ model: rt.model }).bindTools(rt.tools, { parallel_tool_calls: false })

  const hasSystem = state.messages[0]?.getType?.() === 'system'
  const messages = hasSystem ? state.messages : [{ role: 'system', content: rt.systemPrompt }, ...state.messages]
  const response = await modelWithTools.invoke(messages)
  return { messages: [response] }
}

/**
 * Approval node — the structural human-in-the-loop gate, BEFORE any tool runs.
 * Proven deterministic (node-dedicated interrupt + one tool per turn). If the
 * requested tool is confirmation-required (per THIS run's config), it interrupt()s
 * once (no side effect before the pause → replay is free). On decline it emits a
 * blocked ToolMessage so the tool never runs; on approve it falls through.
 */
async function approvalNode(state, config) {
  const rt = resolveRuntime(config)
  const last = state.messages[state.messages.length - 1]
  const call = (last.tool_calls ?? [])[0]
  if (!call || !rt.confirmRequired.has(call.name)) return {}

  const proposed = call.args ?? {}
  const decision = interrupt({
    action: call.name,
    risk: rt.toolRisk[call.name] ?? 'medium',
    requiresConfirmation: true,
    proposed,
    message: `Approve running "${call.name}"${proposed.name ? ` for "${proposed.name}"` : ''}? This prepares a proposal; nothing is persisted.`,
  })
  const approved = decision && typeof decision === 'object' ? decision.approved === true : decision === true
  if (approved) return {} // fall through to the tools node — the gated tool runs

  // Declined: answer the gated call with a blocked ToolMessage so it never runs.
  return {
    messages: [
      new ToolMessage({
        content: JSON.stringify({ ok: false, blocked: true, reason: 'human declined (confirmation not granted)' }),
        tool_call_id: call.id ?? call.name,
      }),
    ],
  }
}

async function toolsNode(state, config) {
  const rt = resolveRuntime(config)
  const last = state.messages[state.messages.length - 1]
  // Skip any call already answered by the approval node (a declined tool).
  const answered = new Set(state.messages.filter((m) => (m.getType?.() ?? m.type) === 'tool').map((m) => m.tool_call_id))
  const calls = (last.tool_calls ?? []).filter((c) => !answered.has(c.id ?? c.name))
  const out = []
  for (const call of calls) {
    const t = rt.toolsByName[call.name]
    let content
    try {
      content = t
        ? await t.invoke(call.args ?? {})
        : JSON.stringify({ ok: false, reason: `tool '${call.name}' not in allowlist` })
    } catch (e) {
      // A tool that throws (e.g. PostgREST unavailable) must not crash the run.
      content = JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
    out.push(new ToolMessage({ content: String(content), tool_call_id: call.id ?? call.name }))
  }
  return { messages: out }
}

// Any tool call → approval (which gates then falls to tools); none → END.
function routeAgent(state) {
  const last = state.messages[state.messages.length - 1]
  return (last.tool_calls ?? []).length > 0 ? 'approval' : END
}

// After approval: if the gated call was declined (already answered), go back to
// the agent; otherwise run the tool.
function routeApproval(state) {
  const lastAi = [...state.messages].reverse().find((m) => (m.getType?.() ?? m.type) === 'ai' || (m.getType?.() ?? m.type) === 'assistant')
  const answered = new Set(state.messages.filter((m) => (m.getType?.() ?? m.type) === 'tool').map((m) => m.tool_call_id))
  const pending = (lastAi?.tool_calls ?? []).filter((c) => !answered.has(c.id ?? c.name))
  return pending.length > 0 ? 'tools' : 'agent'
}

export const graph = new StateGraph(MessagesAnnotation)
  .addNode('agent', agentNode)
  .addNode('approval', approvalNode)
  .addNode('tools', toolsNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', routeAgent, ['approval', END])
  .addConditionalEdges('approval', routeApproval, ['tools', 'agent'])
  .addEdge('tools', 'agent')
  .compile()
