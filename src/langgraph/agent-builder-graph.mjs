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
    description: 'Read an existing project summary (name, platform, linked repo) — read-only.',
    schema: z.object({ projectId: z.string().optional() }),
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
    description: 'Read an existing copilot summary (status, model, health, runtime) — read-only.',
    schema: z.object({ copilotId: z.string().optional() }),
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
    description: "Read a copilot's recent runs (status, cost, latency) — read-only.",
    schema: z.object({ copilotId: z.string().optional(), limit: z.number().optional() }),
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
    description: 'Read the tool permission matrix for a copilot (risk, confirmation) — read-only.',
    schema: z.object({ copilotId: z.string().optional() }),
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
      name: z.string().optional(),
      description: z.string().optional(),
      runtime: z.string().optional(),
      model: z.string().optional(),
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
  'You CANNOT auto-promote to production, push to external repos, create unconfirmed write tools, or bypass approval.',
  'Prefer least-privilege, read-only proposals. When an action needs confirmation, the tool will pause for human approval.',
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
