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
 * Exports `graph` (the compiled graph) — referenced by langgraph.json.
 */
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { ToolMessage } from '@langchain/core/messages'
import { StateGraph, MessagesAnnotation, START, END, interrupt } from '@langchain/langgraph'
import { z } from 'zod'

import { pgrest } from './pgrest.mjs'
import { buildCopilotDraft } from './draft-spec.mjs'

// ---------------------------------------------------------------------------
// Tool definitions — the 4 read-only tools (live PostgREST) + the gated write.
// ---------------------------------------------------------------------------

const readProjectSummary = tool(
  async ({ projectId }) => {
    if (projectId) {
      const rows = await pgrest(`projects?select=id,name,platform,repo_full_name&id=eq.${encodeURIComponent(projectId)}`)
      return JSON.stringify(rows[0] ?? { error: 'project not found' })
    }
    const rows = await pgrest('projects?select=id,name,platform,repo_full_name&order=created_at')
    return JSON.stringify({ count: rows.length, projects: rows })
  },
  {
    name: 'read_project_summary',
    // Behaviour spelled out because the model can't infer it from the shape:
    // WITHOUT projectId this LISTS every project (with a count); WITH projectId
    // it returns that one project. Prod bug: an unspecified description made the
    // model refuse "list the projects" though no-arg already lists them all.
    description:
      'List or read projects (name, platform, linked repo) — read-only. Call with NO projectId to LIST ALL projects (returns { count, projects }). Pass a projectId to read just that one project.',
    schema: z.object({
      projectId: z
        .string()
        .optional()
        .describe('Omit to list ALL projects; provide an id to read only that project.'),
    }),
  }
)

const readCopilotSummary = tool(
  async ({ copilotId }) => {
    const id = copilotId
    if (id) {
      const rows = await pgrest(
        `copilots?select=id,name,status,model,model_provider,runtime,health&id=eq.${encodeURIComponent(id)}`
      )
      return JSON.stringify(rows[0] ?? { error: 'copilot not found' })
    }
    const rows = await pgrest('copilots?select=id,name,status,model,runtime&order=name')
    return JSON.stringify({ count: rows.length, copilots: rows })
  },
  {
    name: 'read_copilot_summary',
    // Behaviour spelled out because the model can't infer it from the shape:
    // WITHOUT copilotId this LISTS every copilot (with a count); WITH copilotId
    // it returns that one copilot. Prod bug: with the old vague description the
    // model answered "I can only read one copilot by id" and refused to list —
    // even though no-arg lists them ALL (this is the canonical way to count them).
    description:
      'List or read copilots (status, model, runtime, health) — read-only. Call with NO copilotId to LIST ALL copilots (returns { count, copilots }) — this is how you enumerate or count them. Pass a copilotId to read just that one copilot.',
    schema: z.object({
      copilotId: z
        .string()
        .optional()
        .describe('Omit to list ALL copilots (use this to enumerate/count); provide an id to read only that copilot.'),
    }),
  }
)

const readRecentRuns = tool(
  async ({ copilotId, limit }) => {
    const cap = Math.min(Math.max(1, limit ?? 5), 20)
    const filter = copilotId ? `&copilot_id=eq.${encodeURIComponent(copilotId)}` : ''
    const rows = await pgrest(
      `agent_runs?select=id,status,started_at,latency_ms,cost_usd,input_summary,output_summary${filter}&order=started_at.desc&limit=${cap}`
    )
    return JSON.stringify({ count: rows.length, runs: rows })
  },
  {
    name: 'read_recent_runs',
    // Behaviour spelled out: WITHOUT copilotId this returns the most recent runs
    // ACROSS ALL copilots; WITH copilotId it returns only that copilot's runs.
    // `limit` defaults to 5 and is clamped to [1, 20].
    description:
      'Read recent agent runs (status, cost, latency) — read-only. Call with NO copilotId to get the most recent runs across ALL copilots; pass a copilotId to get only that copilot\'s runs. Optional limit defaults to 5, max 20. Returns { count, runs }.',
    schema: z.object({
      copilotId: z
        .string()
        .optional()
        .describe('Omit for recent runs across all copilots; provide an id to filter to one copilot.'),
      limit: z.number().optional().describe('How many runs to return. Default 5, clamped to 1–20.'),
    }),
  }
)

const readToolPermissions = tool(
  async ({ copilotId }) => {
    if (!copilotId) return JSON.stringify({ error: 'copilotId required' })
    const rows = await pgrest(
      `tools?select=name,risk_level,enabled,requires_confirmation,provider&copilot_id=eq.${encodeURIComponent(copilotId)}&order=risk_level,name`
    )
    const needConfirm = rows.filter((r) => r.requires_confirmation).length
    return JSON.stringify({ count: rows.length, requiresConfirmationCount: needConfirm, tools: rows })
  },
  {
    name: 'read_tool_permissions',
    // Behaviour spelled out: unlike the other read tools this one REQUIRES a
    // copilotId (permissions are always scoped to a single copilot); with no id
    // it returns an error, so obtain one via read_copilot_summary first.
    description:
      'Read the tool permission matrix (risk, enabled, requires-confirmation) for ONE copilot — read-only. REQUIRES a copilotId; without it the call returns an error. Returns { count, requiresConfirmationCount, tools }. To find an id first, call read_copilot_summary with no argument.',
    schema: z.object({
      copilotId: z
        .string()
        .optional()
        .describe('REQUIRED — the copilot whose tool permissions to read. Omitting it returns an error.'),
    }),
  }
)

const MODEL = process.env.AGENT_BUILDER_MODEL || 'gpt-5.4'

// The gated WRITE tool — a PURE tool (no interrupt inside). Human approval is
// enforced UPSTREAM by the dedicated `approval` node, so this body only runs
// AFTER approval and never re-runs on replay. It NEVER persists — it returns a
// proposed spec built by the SHARED builder (draft-spec.mjs), so the direct
// path and this path can never diverge.
const draftCopilotSpec = tool(
  async ({ name, description, runtime, model }) => {
    return JSON.stringify({ ok: true, persisted: false, draft: buildCopilotDraft({ name, description, runtime, model }) })
  },
  {
    name: 'draft_copilot_spec',
    description:
      'Prepare a DRAFT copilot spec (manifest + tools + starter tests/benchmark) for human review. Requires human confirmation before it runs; never persists anything.',
    schema: z.object({
      name: z.string().optional().describe('Human-readable name for the copilot to draft.'),
      description: z.string().optional().describe('One-line description of what the copilot does.'),
      // Field docs steer the model toward the platform's real values. The prod
      // bug was the model volunteering "default"/"gpt-4.1" hints — off-platform —
      // when the actual runtime is 'langgraph' and the default model is 'gpt-5.4'.
      // These are hints only (buildCopilotDraft keeps its own safe defaults if
      // omitted); no hard enum, so nothing breaks if the model deviates.
      runtime: z
        .string()
        .optional()
        .describe("Execution runtime. Prefer 'langgraph' (the platform runtime; the only one with a real engine). Omit to default to 'langgraph' — do NOT pass 'default'."),
      model: z
        .string()
        .optional()
        .describe("Model id. Prefer the platform default 'gpt-5.4'. Omit to use it — do NOT pass legacy ids like 'gpt-4.1'."),
    }),
  }
)

const tools = [readProjectSummary, readCopilotSummary, readRecentRuns, readToolPermissions, draftCopilotSpec]
const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]))

// Tools requiring human approval before they run. The `approval` node interrupts
// if the agent's single requested tool is in this set. Read-only tools are
// absent → they run without confirmation.
const CONFIRM_REQUIRED = new Set(['draft_copilot_spec'])
const TOOL_RISK = { draft_copilot_spec: 'medium' }

// ---------------------------------------------------------------------------
// Graph — agent ↔ tools, bounded, with a system prompt matching the copilot.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
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

const model = new ChatOpenAI({ model: MODEL })
// parallel_tool_calls:false → the model requests ONE tool per turn. This keeps
// the approval gate deterministic: a confirmation-required tool is never batched
// behind read tools, so the pause always lands cleanly on a single call.
const modelWithTools = model.bindTools(tools, { parallel_tool_calls: false })

async function agentNode(state) {
  const hasSystem = state.messages[0]?.getType?.() === 'system'
  const messages = hasSystem ? state.messages : [{ role: 'system', content: SYSTEM_PROMPT }, ...state.messages]
  const response = await modelWithTools.invoke(messages)
  return { messages: [response] }
}

/**
 * Approval node — the structural human-in-the-loop gate, BEFORE any tool runs.
 * Proven deterministic (node-dedicated interrupt + one tool per turn). If the
 * requested tool is confirmation-required, it interrupt()s once (no side effect
 * before the pause → replay is free). On decline it emits a blocked ToolMessage
 * so the tool never runs; on approve it falls through to the tools node.
 */
async function approvalNode(state) {
  const last = state.messages[state.messages.length - 1]
  const call = (last.tool_calls ?? [])[0]
  if (!call || !CONFIRM_REQUIRED.has(call.name)) return {}

  const proposed = call.args ?? {}
  const decision = interrupt({
    action: call.name,
    risk: TOOL_RISK[call.name] ?? 'medium',
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

async function toolsNode(state) {
  const last = state.messages[state.messages.length - 1]
  // Skip any call already answered by the approval node (a declined tool).
  const answered = new Set(state.messages.filter((m) => (m.getType?.() ?? m.type) === 'tool').map((m) => m.tool_call_id))
  const calls = (last.tool_calls ?? []).filter((c) => !answered.has(c.id ?? c.name))
  const out = []
  for (const call of calls) {
    const t = toolsByName[call.name]
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
