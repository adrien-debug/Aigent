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
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import { StateGraph, MessagesAnnotation, START, END, interrupt } from '@langchain/langgraph'

import { buildTool, buildToolsFromConfig } from './tool-registry.mjs'
import { createChatModel } from './model-provider.mjs'
import { withTemporalContext } from './temporal-context.mjs'

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

/**
 * Structured marker set on the final AIMessage when the copilot's step budget runs
 * out. The runner keys off THIS flag (response_metadata) rather than string-matching
 * the human-facing sentence — rewording that sentence must never silently turn an
 * unfinished run back into a "completed" one.
 */
export const STEP_BUDGET_EXHAUSTED = 'aigent_step_budget_exhausted'

/**
 * Machine-stable marker for the COST ceiling (twin of STEP_BUDGET_EXHAUSTED).
 * Same transport constraint: the SDK drops custom message keys, so the content
 * is the only channel that survives back to the app.
 */
export const COST_BUDGET_EXHAUSTED = 'aigent_cost_budget_exhausted'

/**
 * Does a manifest `forbiddenActions` entry name this tool?
 *
 * THIRD COPY of one rule — keep aligned with `forbiddenEntryTargetsTool` in
 * `runner.ts` (direct path, pre-execution) and `benchmark-runner.ts` (after the
 * fact). Same semantics everywhere: trim/lowercase, direct equality, otherwise a
 * scan requiring a `[a-z0-9_.-]` word boundary on BOTH sides — so a ban on
 * `delete_customer` does not also catch `delete_customer_note`.
 * @param {string} entry
 * @param {string} toolName
 * @returns {boolean}
 */
export function forbiddenEntryTargetsTool(entry, toolName) {
  const name = String(toolName ?? '').trim().toLowerCase()
  if (name.length === 0) return false
  const haystack = String(entry ?? '').trim().toLowerCase()
  if (haystack === name) return true
  let from = 0
  for (;;) {
    const at = haystack.indexOf(name, from)
    if (at < 0) return false
    const before = at === 0 ? '' : haystack[at - 1]
    const after = haystack[at + name.length] ?? ''
    const isBoundary = (c) => c === '' || !/[a-z0-9_.-]/.test(c)
    if (isBoundary(before) && isBoundary(after)) return true
    from = at + 1
  }
}

/**
 * Cost already spent by THIS run, in USD, computed from state — never a
 * module-level accumulator (the compiled graph is a singleton shared by every
 * run; see countAgentTurns for the same reasoning).
 *
 * Returns `null` when cost is UNKNOWABLE here, and the caller must then enforce
 * nothing: either no price rates were transported (`modelPricing` absent from
 * the assistant config) or the provider returned no `usage_metadata`. A ceiling
 * enforced against an invented rate would be worse than no ceiling.
 * @param {import('@langchain/langgraph').BaseMessage[]} messages
 * @param {{inputUsdPer1M:number,outputUsdPer1M:number}|null} pricing
 * @returns {number|null}
 */
function spentUsd(messages, pricing) {
  if (!pricing || !Number.isFinite(pricing.inputUsdPer1M) || !Number.isFinite(pricing.outputUsdPer1M)) {
    return null
  }
  let inTok = 0
  let outTok = 0
  let sawUsage = false
  for (const m of messages) {
    if ((m.getType?.() ?? m.type) !== 'ai') continue
    const u = m.usage_metadata ?? m.response_metadata?.usage
    if (!u) continue
    const i = u.input_tokens ?? u.prompt_tokens
    const o = u.output_tokens ?? u.completion_tokens
    if (!Number.isFinite(i) && !Number.isFinite(o)) continue
    sawUsage = true
    inTok += Number.isFinite(i) ? i : 0
    outTok += Number.isFinite(o) ? o : 0
  }
  if (!sawUsage) return null
  return (inTok / 1e6) * pricing.inputUsdPer1M + (outTok / 1e6) * pricing.outputUsdPer1M
}

/**
 * Key under which agentNode stamps the model it ACTUALLY instantiated. The
 * LangGraph SDK doesn't surface the provider's own model id to the caller, so
 * without this the app cannot know what really ran (it reported `modelUnverified`).
 */
export const EXECUTED_MODEL = 'aigent_executed_model'
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
 * @returns {{ systemPrompt:string, model:string, modelProvider:string, maxSteps:number, maxCostPerRunUsd:number|null, modelPricing:{inputUsdPer1M:number,outputUsdPer1M:number}|null, tools:any[], toolsByName:Record<string,any>, confirmRequired:Set<string>, toolRisk:Record<string,string> }}
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
      modelProvider: 'openai',
      maxSteps: 12,
      // Legacy fallback carries no manifest → no cost ceiling, no price rates.
      maxCostPerRunUsd: null,
      modelPricing: null,
      forbiddenActions: [],
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
    modelProvider: typeof cfg.modelProvider === 'string' && cfg.modelProvider.trim() ? cfg.modelProvider.trim() : 'openai',
    maxSteps: Number.isFinite(cfg.maxSteps) ? cfg.maxSteps : 12,
    // Cost twin of maxSteps, same transport channel (manifests.max_cost_per_run_usd
    // → ManifestRowForBehavior → CopilotBehaviorConfig → config.configurable).
    maxCostPerRunUsd:
      Number.isFinite(cfg.maxCostPerRunUsd) && cfg.maxCostPerRunUsd > 0 ? cfg.maxCostPerRunUsd : null,
    modelPricing:
      cfg.modelPricing &&
      Number.isFinite(cfg.modelPricing.inputUsdPer1M) &&
      Number.isFinite(cfg.modelPricing.outputUsdPer1M)
        ? cfg.modelPricing
        : null,
    forbiddenActions: Array.isArray(cfg.forbiddenActions)
      ? cfg.forbiddenActions.filter((a) => typeof a === 'string' && a.trim().length > 0)
      : [],
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
  const hasSystem = state.messages[0]?.getType?.() === 'system'

  // TEMPORAL ANCHORING — injected HERE, at run time, and deliberately NOT in
  // composeSystemPrompt: that prompt is frozen onto the assistant at
  // provisioning, so a date baked in there would be the provisioning day
  // forever. `withTemporalContext` is idempotent (marker check), so a resumed
  // run whose checkpointed system message already carries a block never gets a
  // second, contradictory clock.
  const now = new Date()
  let baseMessages
  if (hasSystem) {
    const sys = state.messages[0]
    const sysText = typeof sys.content === 'string' ? sys.content : rt.systemPrompt
    const anchored = withTemporalContext(sysText, now)
    baseMessages =
      anchored === sysText
        ? state.messages
        : [{ role: 'system', content: anchored }, ...state.messages.slice(1)]
  } else {
    baseMessages = [
      { role: 'system', content: withTemporalContext(rt.systemPrompt, now) },
      ...state.messages,
    ]
  }

  // COST CEILING (twin of the step-budget guard below). Fail-closed but never
  // fabricated: `spentUsd` returns null when no price rates were transported or
  // the provider reported no usage, and in that case we enforce nothing rather
  // than stopping a run on a made-up number.
  if (rt.maxCostPerRunUsd != null) {
    const spent = spentUsd(state.messages, rt.modelPricing)
    if (spent != null && spent >= rt.maxCostPerRunUsd) {
      return {
        messages: [
          new AIMessage({
            content:
              `${COST_BUDGET_EXHAUSTED} ` +
              `I stopped here: this run reached its configured cost ceiling ` +
              `($${rt.maxCostPerRunUsd} per run; approximately $${spent.toFixed(4)} spent, an estimate ` +
              `from token usage and list prices, not billing truth). No further model call was made. ` +
              `Please start a new run or narrow the request.`,
          }),
        ],
      }
    }
  }

  if (turnsTaken >= rt.maxSteps) {
    // Budget reached. Real thread traces (Security Sentinel, exposed-secrets)
    // showed the failure mode is NOT "no tool progress" — it's the opposite:
    // the agent kept calling read tools every turn and NEVER wrote a synthesis,
    // so it hit the recursion limit mid-search and the judge saw an empty
    // answer. The old behaviour here (emit a static sentinel and stop) made
    // that worse: it threw away everything the agent had gathered.
    //
    // Instead, take ONE final turn with the tools UNBOUND (no tools available →
    // the model cannot request another one → routeAgent sends END → the graph
    // terminates cleanly): force a bounded answer from the context already
    // collected. The STEP_BUDGET_EXHAUSTED prefix is still prepended so the
    // machine-stable marker survives (the SDK drops custom keys — content is
    // the only channel), but now it precedes a REAL, judgeable review instead
    // of a boilerplate apology.
    try {
      const closingModel = createChatModel({ model: rt.model, modelProvider: rt.modelProvider })
      const closing = await closingModel.invoke([
        ...baseMessages,
        {
          role: 'user',
          content:
            'You have reached your tool-step budget and cannot call any more tools. ' +
            'Do NOT ask to run another tool. Using ONLY what you have already gathered above, ' +
            'produce your final bounded answer now: a concise findings list (category, risk, ' +
            'evidence or explicit limitation, and a safe read-only next check). If evidence is ' +
            'incomplete, say so plainly rather than continuing.',
        },
      ])
      const finalText = typeof closing.content === 'string' ? closing.content : JSON.stringify(closing.content)
      return { messages: [new AIMessage({ content: `${STEP_BUDGET_EXHAUSTED} ${finalText}` })] }
    } catch {
      // The closing completion failed (provider down): fall back to the static
      // sentinel so the run still terminates cleanly rather than looping.
      return {
        messages: [
          new AIMessage({
            content:
              `${STEP_BUDGET_EXHAUSTED} ` +
              'I stopped here: this copilot’s step budget (maxSteps) is exhausted, so I could not finish the task. ' +
              'Please start a new run or narrow the request so it fits within the remaining steps.',
          }),
        ],
      }
    }
  }

  // Instantiate the model PER RUN from the config — one compiled graph serves
  // every copilot's model. parallel_tool_calls:false → ONE tool per turn, which
  // keeps the approval gate deterministic (a gated tool is never batched behind
  // read tools, so the pause lands cleanly on a single call).
  const modelWithTools = createChatModel({ model: rt.model, modelProvider: rt.modelProvider }).bindTools(rt.tools, {
    parallel_tool_calls: false,
  })

  const response = await modelWithTools.invoke(baseMessages)

  // NOTE — we cannot tell the app which model actually ran, and that is a real
  // limitation, not an oversight. Verified empirically: the SDK deserializes
  // messages into LangChain objects and DROPS every custom key, in BOTH
  // `additional_kwargs` AND `response_metadata` (same run: the raw HTTP API returns
  // `{"aigent_executed_model":"gpt-5.4"}`, `runs.wait` returns `{}`). The provider's
  // own model id isn't passed through either (response_metadata carries only
  // `model_provider` + `usage`). The only channel that survives is the message
  // CONTENT — and we will not pollute the user-facing answer with a model tag.
  // So the app reports `modelUnverified: true` on this path. That is the HONEST
  // answer: we'd rather say "unknown" than assert the REQUESTED model, which the
  // graph may silently have replaced with DEFAULT_MODEL when the assistant config
  // carries no model. Never affirm a fact we cannot verify.
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
  if (!call) return {}

  // FORBIDDEN first, and terminal: a manifest interdiction is not confirmable,
  // so it must be checked BEFORE the confirmation gate (never surface an
  // approval dialog for something no approval can authorise). The declined-tool
  // ToolMessage keeps the tool from ever reaching toolsNode, exactly like a
  // human decline — same {blocked:true} shape the app already understands.
  const forbiddenHit = (rt.forbiddenActions ?? []).find((entry) =>
    forbiddenEntryTargetsTool(entry, call.name)
  )
  if (forbiddenHit !== undefined) {
    return {
      messages: [
        new ToolMessage({
          content: JSON.stringify({
            ok: false,
            blocked: true,
            reason:
              `tool '${call.name}' is named by a manifest forbiddenActions entry ` +
              `("${forbiddenHit}") — blocked, never executed`,
          }),
          tool_call_id: call.id ?? call.name,
        }),
      ],
    }
  }

  if (!rt.confirmRequired.has(call.name)) return {}

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
