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

// The GATED write tool. It calls interrupt() FIRST — the graph pauses for human
// approval before it ever produces the draft. On resume with { approved:true }
// it returns a proposed spec (still NEVER persists — pure proposal). On
// { approved:false } (or anything else) it refuses.
const draftCopilotSpec = tool(
  async ({ name, description }) => {
    const decision = interrupt({
      action: 'draft_copilot_spec',
      risk: 'medium',
      requiresConfirmation: true,
      proposed: { name: name ?? '(unnamed)', description: description ?? '' },
      message: `Approve drafting a copilot spec for "${name ?? '(unnamed)'}"? This only prepares a proposal; nothing is persisted.`,
    })

    const approved = decision && typeof decision === 'object' ? decision.approved === true : decision === true
    if (!approved) {
      return JSON.stringify({ ok: false, blocked: true, reason: 'human declined the draft (confirmation not granted)' })
    }
    return JSON.stringify({
      ok: true,
      persisted: false,
      draft: {
        name: name ?? '(unnamed)',
        description: description ?? '',
        suggestedRuntime: 'langgraph',
        suggestedModel: 'gpt-5.4',
        proposedTools: ['read_project_summary', 'read_copilot_summary', 'read_recent_runs', 'read_tool_permissions'],
        proposedManifest: {
          confirmationPolicy: 'risky-only',
          forbiddenActions: ['auto-promote to production', 'push to external repos'],
          projectId: null,
        },
      },
    })
  },
  {
    name: 'draft_copilot_spec',
    description:
      'Prepare a DRAFT copilot spec for human review. Requires human confirmation (interrupt) before it drafts; never persists anything.',
    schema: z.object({ name: z.string().optional(), description: z.string().optional() }),
  }
)

const tools = [readProjectSummary, readCopilotSummary, readRecentRuns, readToolPermissions, draftCopilotSpec]
const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]))

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

const model = new ChatOpenAI({ model: process.env.AGENT_BUILDER_MODEL || 'gpt-5.4' })
const modelWithTools = model.bindTools(tools)

async function agentNode(state) {
  const messages = state.messages[0]?.getType?.() === 'system'
    ? state.messages
    : [{ role: 'system', content: SYSTEM_PROMPT }, ...state.messages]
  const response = await modelWithTools.invoke(messages)
  return { messages: [response] }
}

async function toolsNode(state) {
  const last = state.messages[state.messages.length - 1]
  const calls = last.tool_calls ?? []
  const out = []
  for (const call of calls) {
    const t = toolsByName[call.name]
    const content = t
      ? await t.invoke(call.args ?? {})
      : JSON.stringify({ ok: false, reason: `tool '${call.name}' not in allowlist` })
    out.push(new ToolMessage({ content: String(content), tool_call_id: call.id ?? call.name }))
  }
  return { messages: out }
}

function routeAgent(state) {
  const last = state.messages[state.messages.length - 1]
  return (last.tool_calls ?? []).length > 0 ? 'tools' : END
}

export const graph = new StateGraph(MessagesAnnotation)
  .addNode('agent', agentNode)
  .addNode('tools', toolsNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', routeAgent, ['tools', END])
  .addEdge('tools', 'agent')
  .compile()
