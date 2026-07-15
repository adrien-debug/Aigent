/**
 * Project Builder — persistent conversation store + architect turns (server only).
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

import type OpenAI from 'openai'

import { AGENT_BUILDER_SLUG } from './agent-builder-copilot'
import {
  draftToCreateInput,
  getAgentBuilderRunState,
  resumeAgentBuilderRun,
  startAgentBuilderRun,
  type BuilderManifestDraft,
  type BuilderProposedTool,
  type BuilderRunState,
} from './agent-builder-run'
import {
  createCopilotFromManifest,
  deleteCopilotCascade,
  setCopilotAssistantId,
} from './authoring-writes'
import { getCopilot, getProject } from './data'
import { getRepoFile, getRepoTree, searchRepoCode } from './github'
import { agentServerClient } from './langgraph-client'
import { deleteCopilotAssistant, ensureCopilotAssistant } from './langgraph-assistants'
import { getOpenAIClient, ARCHITECT_MODEL } from './llm-client'
import {
  PROJECT_BUILDER_ARCHITECT_SYSTEM,
  PROJECT_BUILDER_REPO_TOOL_NAMES,
  PROJECT_BUILDER_TOOLS,
} from './project-builder-architect-prompt'
import {
  canStartDraftMaterialization,
  defaultAgentFlow,
  mergePreview,
  redactMessageContent,
  selectPreviewOption,
} from './project-builder-preview'
import type {
  AgentPreview,
  ProjectBuilderConversation,
  ProjectBuilderConversationBundle,
  ProjectBuilderMessage,
} from './project-builder-types'
import { pgrest } from './postgrest'
import { loadRepoIntelligence } from './repo-intelligence-store'
import { repoScanToContext, scanProjectRepo } from './repo-scan'
import { makeId } from './slug'

type RawRow = Record<string, unknown>

const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`

const MAX_MESSAGES_LOAD = 80
const MAX_MESSAGES_FOR_LLM = 24
const MAX_MESSAGE_CHARS = 12_000
const OPENAI_TIMEOUT_MS = 90_000

/** Hard ceiling on repo-tool round-trips per architect turn — bounds cost and latency. */
const MAX_TOOL_ITERATIONS = 8
/** Repo tool output is truncated to this many chars before being handed back to the model. */
const MAX_TOOL_RESULT_CHARS = 6_000
const MAX_COMPLETION_TOKENS = 4_096

function rowToConversation(row: RawRow): ProjectBuilderConversation {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    status: row.status as ProjectBuilderConversation['status'],
    langgraphThreadId: (row.langgraph_thread_id as string | null) ?? null,
    latestPreview: (row.latest_preview as AgentPreview | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function rowToMessage(row: RawRow): ProjectBuilderMessage {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    role: row.role as ProjectBuilderMessage['role'],
    content: row.content as string,
    createdAt: row.created_at as string,
    metadata: (row.metadata as Record<string, unknown> | undefined) ?? undefined,
  }
}

function repoSummaryFromIntel(intel: Awaited<ReturnType<typeof loadRepoIntelligence>>['intelligence']): string | null {
  if (!intel) return null
  const stack = intel.map.stack.slice(0, 6).join(', ')
  return `${stack} · ${intel.map.apiRoutes.length} API routes · ${intel.map.components.length} components · ${intel.recommendations.length} suggestion(s)`
}

function intelContextBlock(intel: Awaited<ReturnType<typeof loadRepoIntelligence>>['intelligence']): string {
  if (!intel) return 'Repo intelligence: not available yet (scan may still be running or repo unlinked).'
  const recs = intel.recommendations
    .slice(0, 5)
    .map((r) => `- ${r.title} (${r.priority}): ${r.why}`)
    .join('\n')
  return [
    'REPO INTELLIGENCE (bounded read-only scan — not exhaustive):',
    `Stack: ${intel.map.stack.join(', ') || 'unknown'}`,
    `Scripts: ${Object.keys(intel.map.scripts).join(', ') || 'none listed'}`,
    `API routes: ${intel.map.apiRoutes.length}, components: ${intel.map.components.length}, tests: ${intel.map.tests.length}`,
    `Design system signals: ${intel.map.designSystemSignals.join('; ') || 'none'}`,
    `Agentic footprint: ${intel.footprint.hasAgenticCode ? intel.footprint.frameworks.join(', ') : 'none detected'}`,
    `Residue findings: ${intel.residue.length}`,
    recs ? `Top recommendations:\n${recs}` : 'No ranked recommendations.',
  ].join('\n')
}

async function appendMessage(
  conversationId: string,
  role: ProjectBuilderMessage['role'],
  content: string,
  metadata?: Record<string, unknown>
): Promise<ProjectBuilderMessage> {
  const now = new Date().toISOString()
  const id = makeId('pbmsg', `${conversationId}-${randomUUID().slice(0, 8)}`)
  const safe = redactMessageContent(content)
  await pgrest('POST', 'project_builder_messages', {
    id,
    conversation_id: conversationId,
    role,
    content: safe,
    metadata: metadata ?? {},
    created_at: now,
  })
  await pgrest('PATCH', `project_builder_conversations?${eq('id', conversationId)}`, { updated_at: now })
  return { id, conversationId, role, content: safe, createdAt: now, metadata }
}

async function loadMessages(conversationId: string): Promise<ProjectBuilderMessage[]> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `project_builder_messages?${eq('conversation_id', conversationId)}&select=*&order=created_at.asc&limit=${MAX_MESSAGES_LOAD}`
  )
  return rows.map(rowToMessage)
}

/**
 * A `draft_created` conversation points at a copilot row that can disappear
 * afterwards (manual delete, cascade). Nothing re-checks that reference, so the
 * conversation freezes: chat refuses new turns on `draft_created`, the preview
 * links to an agent that 404s, and "Approve — create draft" never comes back —
 * the spec is agreed but unreachable. Verify the reference before trusting it:
 *  - copilot found → the draft is real, leave the conversation untouched.
 *  - row gone → drop ONLY the dead id and unblock the status. The thread and the
 *    agreed spec survive, so the user re-approves instead of re-discussing.
 *  - PostgREST error → propagate; an unreachable backend is not proof of a
 *    deletion, and clearing on a network blip would strip a live draft's link.
 */
async function reconcileStaleDraftReference(
  conversation: ProjectBuilderConversation
): Promise<ProjectBuilderConversation> {
  const preview = conversation.latestPreview
  const draftedId = preview?.createdCopilotId
  if (!preview || !draftedId) return conversation
  if (await getCopilot(draftedId)) return conversation

  console.warn(
    `[project-builder] stale createdCopilotId ${draftedId} on conversation ${conversation.id} (copilot row gone) — clearing and re-arming draft creation`
  )
  const { createdCopilotId: _deleted, ...survivingPreview } = preview
  const status: ProjectBuilderConversation['status'] = survivingPreview.readyForApproval ? 'draft_ready' : 'active'
  await pgrest('PATCH', `project_builder_conversations?${eq('id', conversation.id)}`, {
    latest_preview: survivingPreview,
    status,
    updated_at: new Date().toISOString(),
  })
  return { ...conversation, status, latestPreview: survivingPreview }
}

export async function ensureActiveProjectBuilderConversation(projectId: string): Promise<ProjectBuilderConversation> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `project_builder_conversations?${eq('project_id', projectId)}&status=in.(active,draft_ready,draft_created)&select=*&order=updated_at.desc&limit=1`
  )
  if (rows[0]) return reconcileStaleDraftReference(rowToConversation(rows[0]))

  const now = new Date().toISOString()
  const id = makeId('pbconv', `${projectId}-${randomUUID().slice(0, 8)}`)
  await pgrest('POST', 'project_builder_conversations', {
    id,
    project_id: projectId,
    status: 'active',
    langgraph_thread_id: null,
    latest_preview: null,
    created_at: now,
    updated_at: now,
  })
  return {
    id,
    projectId,
    status: 'active',
    langgraphThreadId: null,
    latestPreview: null,
    createdAt: now,
    updatedAt: now,
  }
}

export async function getProjectBuilderConversationBundle(projectId: string): Promise<ProjectBuilderConversationBundle> {
  const conversation = await ensureActiveProjectBuilderConversation(projectId)
  const messages = await loadMessages(conversation.id)

  let repoSummary: string | null = null
  try {
    const cached = await loadRepoIntelligence(projectId)
    repoSummary = repoSummaryFromIntel(cached.intelligence)
  } catch {
    repoSummary = null
  }

  const createdCopilotId = conversation.latestPreview?.createdCopilotId ?? null
  const runState = await reconstructRunState(conversation)

  return { conversation, messages, repoSummary, createdCopilotId, runState }
}

function parsePreviewToolArgs(raw: string): Partial<AgentPreview> | null {
  try {
    return JSON.parse(raw) as Partial<AgentPreview>
  } catch {
    return null
  }
}

function truncateToolResult(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n…[truncated, ${text.length} chars total]`
}

/**
 * Execute one repo-reading tool call (list_repo_tree / read_repo_file / search_repo)
 * against the linked repo via github.ts's validated, secret-path-denying helpers.
 * Never throws: a failure (no repo linked, no token, GitHub error, secret path)
 * becomes a clean `{ error }` string handed back to the model as the tool result,
 * so the architect can react ("I can't open that file") instead of the turn crashing.
 */
async function runRepoTool(
  toolName: string,
  rawArgs: string,
  repoFullName: string | undefined
): Promise<string> {
  if (!repoFullName) {
    return JSON.stringify({ error: 'repo read unavailable: this project has no linked GitHub repo' })
  }
  if (!process.env.GITHUB_TOKEN) {
    return JSON.stringify({ error: 'repo read unavailable: GITHUB_TOKEN is not configured' })
  }

  let args: Record<string, unknown>
  try {
    args = rawArgs.trim().length > 0 ? (JSON.parse(rawArgs) as Record<string, unknown>) : {}
  } catch {
    return JSON.stringify({ error: 'invalid tool arguments: could not parse JSON' })
  }

  try {
    switch (toolName) {
      case 'list_repo_tree': {
        const scopePath = typeof args.path === 'string' ? args.path.replace(/^\/+/, '') : ''
        const tree = await getRepoTree(repoFullName)
        const scoped = scopePath
          ? tree.filter((e) => e.path === scopePath || e.path.startsWith(`${scopePath}/`))
          : tree
        const entries = scoped.slice(0, 300).map((e) => ({ path: e.path, type: e.type }))
        return truncateToolResult(
          JSON.stringify({ repo: repoFullName, path: scopePath || '(root)', count: scoped.length, entries })
        )
      }
      case 'read_repo_file': {
        const path = typeof args.path === 'string' ? args.path : ''
        if (!path) return JSON.stringify({ error: 'missing required argument: path' })
        const file = await getRepoFile(repoFullName, path)
        return truncateToolResult(
          JSON.stringify({ path: file.path, truncated: file.truncated, content: file.text })
        )
      }
      case 'search_repo': {
        const query = typeof args.query === 'string' ? args.query : ''
        if (!query) return JSON.stringify({ error: 'missing required argument: query' })
        const result = await searchRepoCode(repoFullName, query)
        return truncateToolResult(
          JSON.stringify({
            totalCount: result.totalCount,
            incomplete: result.incomplete,
            matches: result.matches.slice(0, 20),
          })
        )
      }
      default:
        return JSON.stringify({ error: `unknown repo tool: ${toolName}` })
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : 'repo read failed' })
  }
}

/**
 * Result of a completions call that may or may not have been streamed — either
 * way the loop only cares about the final assistant message shape (content +
 * tool_calls), so both code paths converge on this before continuing.
 */
type CompletionOutcome = {
  content: string | null
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined
}

/**
 * Run one `chat.completions.create` call. When `onToken` is provided, the call
 * is made with `stream: true` and every content delta is forwarded to it as it
 * arrives — this is the ONLY place streaming happens; tool-call arguments are
 * still accumulated fully before being returned (repo-tool dispatch needs the
 * complete JSON, not partial deltas). When `onToken` is omitted, behaves as a
 * plain non-streaming call. Both paths return the same normalized shape.
 */
async function runCompletion(
  client: OpenAI,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  onToken?: (delta: string) => void
): Promise<CompletionOutcome> {
  if (!onToken) {
    const response = await client.chat.completions.create(params, { timeout: OPENAI_TIMEOUT_MS })
    const msg = response.choices[0]?.message
    if (!msg) throw new Error('architect returned empty completion')
    return { content: msg.content ?? null, toolCalls: msg.tool_calls }
  }

  const stream = await client.chat.completions.create(
    { ...params, stream: true },
    { timeout: OPENAI_TIMEOUT_MS }
  )

  let content = ''
  const toolCallsByIndex = new Map<
    number,
    { id: string; type: 'function'; function: { name: string; arguments: string } }
  >()

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta
    if (!delta) continue

    if (typeof delta.content === 'string' && delta.content.length > 0) {
      content += delta.content
      onToken(delta.content)
    }

    for (const tc of delta.tool_calls ?? []) {
      const existing = toolCallsByIndex.get(tc.index)
      if (!existing) {
        toolCallsByIndex.set(tc.index, {
          id: tc.id ?? '',
          type: 'function',
          function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '' },
        })
      } else {
        if (tc.id) existing.id = tc.id
        if (tc.function?.name) existing.function.name += tc.function.name
        if (tc.function?.arguments) existing.function.arguments += tc.function.arguments
      }
    }
  }

  const toolCalls =
    toolCallsByIndex.size > 0
      ? Array.from(toolCallsByIndex.entries())
          .sort(([a], [b]) => a - b)
          .map(([, v]) => v)
      : undefined

  return { content: content.length > 0 ? content : null, toolCalls }
}

/**
 * One architect turn, run as an AGENTIC LOOP: the model gets update_preview
 * PLUS three read-only repo tools (list_repo_tree/read_repo_file/search_repo).
 * As long as it keeps calling repo tools, we execute them against the real
 * linked repo (via github.ts) and feed the results back as `tool` messages,
 * then re-call the model — up to MAX_TOOL_ITERATIONS round-trips — until it
 * produces actual prose (its framing/question/reformulation), optionally
 * alongside an update_preview call. The bounded repo intelligence summary is
 * still injected as an initial hint, but the model can now dig past it into
 * real files.
 *
 * The repo-tool-calling iterations are NEVER streamed (their output is JSON
 * tool-call arguments, not prose a user should watch appear token by token).
 * Only the call that actually returns prose — inside the loop the turn it
 * stops calling tools, or the forced final wrap-up call after the tool budget
 * is exhausted — is made with streaming when `onToken` is supplied.
 */
async function runArchitectLoop(
  args: {
    messages: ProjectBuilderMessage[]
    repoContext: string
    currentPreview: AgentPreview | null
    repoFullName: string | undefined
  },
  onToken?: (delta: string) => void
): Promise<{ reply: string; previewPatch: Partial<AgentPreview> | null }> {
  const client = getOpenAIClient()
  const recent = args.messages.slice(-MAX_MESSAGES_FOR_LLM)

  const repoToolsAvailable = Boolean(args.repoFullName && process.env.GITHUB_TOKEN)
  const toolsNote = repoToolsAvailable
    ? `Repo tools are AVAILABLE for ${args.repoFullName} — use list_repo_tree/read_repo_file/search_repo to verify claims against real files instead of relying only on the summary below.`
    : 'Repo tools are UNAVAILABLE right now (no linked repo or no GitHub access) — be honest that you can only reason from the bounded summary below.'

  const openAiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `${PROJECT_BUILDER_ARCHITECT_SYSTEM}\n\n${toolsNote}\n\n${args.repoContext}\n\nCurrent preview JSON (may be empty):\n${JSON.stringify(args.currentPreview ?? {})}`,
    },
    ...recent.map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: m.content,
    })),
  ]

  let previewPatch: Partial<AgentPreview> | null = null
  let toolBudgetExhausted = false

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    // Tool-scouting iterations are speculative (the model may just call more
    // repo tools) — never stream these; only the turn that actually lands on
    // prose (handled below, before we know whether more tools follow) matters
    // for the user-visible transport. We still pass onToken here: if the
    // model DOES produce prose on iteration 1, that's the real final answer
    // and should stream immediately rather than waiting for a later call.
    const outcome = await runCompletion(
      client,
      {
        model: ARCHITECT_MODEL,
        messages: openAiMessages,
        tools: PROJECT_BUILDER_TOOLS,
        tool_choice: 'auto',
        max_completion_tokens: MAX_COMPLETION_TOKENS,
      },
      onToken
    )

    const previewCall = outcome.toolCalls?.find((t) => t.type === 'function' && t.function.name === 'update_preview')
    if (previewCall && previewCall.type === 'function') {
      previewPatch = parsePreviewToolArgs(previewCall.function.arguments)
    }

    // If the model already produced prose this turn, that IS its answer — return
    // it even if it also queued more repo tool calls. Waiting for a turn with
    // ZERO tool calls is what starved the loop into the fallback: gpt keeps
    // wanting "one more file" and never lands on a tool-free turn.
    const proseThisTurn = typeof outcome.content === 'string' ? outcome.content.trim() : ''

    // If the model produced prose this turn, that IS its answer — return it even
    // if it also queued repo calls. Waiting for a turn with ZERO tool calls is
    // what starved the loop: gpt keeps wanting "one more file". We have not
    // mutated openAiMessages yet on this iteration, so the history stays valid.
    if (proseThisTurn.length > 0) {
      if (previewPatch && !previewPatch.flow?.length) previewPatch.flow = defaultAgentFlow()
      return { reply: proseThisTurn, previewPatch }
    }

    const toolCalls = (outcome.toolCalls ?? []).filter((t) => t.type === 'function')

    if (toolCalls.length === 0) {
      // No prose and no tool calls at all — nothing to continue on, wrap up.
      toolBudgetExhausted = true
      break
    }

    // Append the assistant turn (with its tool_calls) before any tool results,
    // as OpenAI's chat format requires.
    openAiMessages.push({
      role: 'assistant',
      content: outcome.content ?? null,
      tool_calls: outcome.toolCalls,
    } as OpenAI.Chat.Completions.ChatCompletionMessageParam)

    // EVERY tool_call in that assistant message MUST get a tool response, or the
    // next request 400s. Repo calls run for real; update_preview gets an ack (it
    // was already captured into previewPatch above). This was the bug: only repo
    // calls were answered, leaving update_preview's id dangling.
    const atBudget = iteration === MAX_TOOL_ITERATIONS - 1
    for (const call of toolCalls) {
      if (call.type !== 'function') continue
      let content: string
      if (PROJECT_BUILDER_REPO_TOOL_NAMES.has(call.function.name)) {
        content = atBudget
          ? JSON.stringify({ note: 'repo-read budget reached for this turn; answer in prose now' })
          : await runRepoTool(call.function.name, call.function.arguments, args.repoFullName)
      } else {
        // update_preview (or any non-repo tool): already handled, just ack it.
        content = JSON.stringify({ ok: true, applied: true })
      }
      openAiMessages.push({ role: 'tool', tool_call_id: call.id, content })
    }

    if (atBudget) {
      toolBudgetExhausted = true
      break
    }
  }

  if (toolBudgetExhausted) {
    console.warn(
      `[project-builder] architect turn hit MAX_TOOL_ITERATIONS=${MAX_TOOL_ITERATIONS} repo-tool budget for repo ${args.repoFullName ?? '(none)'}`
    )
    // Force one final call with tools disabled so the model must answer in prose.
    const finalOutcome = await runCompletion(
      client,
      {
        model: ARCHITECT_MODEL,
        messages: [
          ...openAiMessages,
          {
            role: 'system',
            content:
              'Stop reading the repo now. In prose, reformulate what the operator wants, state what you found in the repo, and ask your next scoping question. Do not call any tool.',
          },
        ],
        // Force a text answer — with tools still offered the model can keep
        // trying to call one and return empty content, which is exactly what
        // dropped us into the fallback.
        tools: PROJECT_BUILDER_TOOLS,
        tool_choice: 'none',
        max_completion_tokens: MAX_COMPLETION_TOKENS,
      },
      onToken
    )
    const reply = typeof finalOutcome.content === 'string' ? finalOutcome.content.trim() : ''
    if (reply.length > 0) {
      if (previewPatch && !previewPatch.flow?.length) previewPatch.flow = defaultAgentFlow()
      return { reply, previewPatch }
    }
  }

  // Fallback: should be rare given the system prompt requires prose every turn.
  // More useful than a generic line — invites the operator to redirect.
  const fallback =
    "I dug into the repo but didn't land on a clear next step — could you tell me more about what this agent should do, or point me at a specific file/folder to look at?"
  if (previewPatch && !previewPatch.flow?.length) previewPatch.flow = defaultAgentFlow()
  if (onToken && fallback.length > 0) onToken(fallback)
  return { reply: fallback, previewPatch }
}

export async function generateArchitectTurn(args: {
  messages: ProjectBuilderMessage[]
  repoContext: string
  currentPreview: AgentPreview | null
  repoFullName: string | undefined
}): Promise<{ reply: string; previewPatch: Partial<AgentPreview> | null }> {
  return runArchitectLoop(args)
}

/**
 * Same agentic loop as `generateArchitectTurn`, but the call that produces the
 * final prose is made with `stream: true` and every content delta is pushed to
 * `onToken` as it arrives. The repo-tool-scouting round-trips are unaffected —
 * they still run to completion internally before the model gets another turn.
 * Returns the same `{ reply, previewPatch }` shape once the full prose has
 * been accumulated, so callers can persist exactly as `generateArchitectTurn`
 * callers do today.
 */
export async function streamArchitectTurn(
  args: {
    messages: ProjectBuilderMessage[]
    repoContext: string
    currentPreview: AgentPreview | null
    repoFullName: string | undefined
  },
  onToken: (delta: string) => void
): Promise<{ reply: string; previewPatch: Partial<AgentPreview> | null }> {
  return runArchitectLoop(args, onToken)
}

/**
 * Shared prep for both the non-streaming and streaming entry points: validate
 * the incoming message, persist the user turn, load the refreshed message
 * history, and resolve the same repo-intelligence + repoFullName context the
 * architect loop needs. Returns everything `generateArchitectTurn` /
 * `streamArchitectTurn` require so both callers build the identical context.
 */
async function prepareArchitectTurnContext(
  projectId: string,
  content: string
): Promise<{
  conversation: ProjectBuilderConversation
  messages: ProjectBuilderMessage[]
  intelBlock: string
  repoFullName: string | undefined
}> {
  const trimmed = content.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_MESSAGE_CHARS) {
    throw new Error('message must be 1–12000 characters')
  }

  const conversation = await ensureActiveProjectBuilderConversation(projectId)
  if (conversation.status === 'draft_created') {
    throw new Error('this conversation already produced a draft — reload to start a fresh thread')
  }

  await appendMessage(conversation.id, 'user', trimmed)

  const messages = await loadMessages(conversation.id)

  let intelBlock = 'Repo intelligence unavailable.'
  try {
    const cached = await loadRepoIntelligence(projectId)
    intelBlock = intelContextBlock(cached.intelligence)
  } catch {
    // Non-fatal — architect proceeds with honest uncertainty.
  }

  let repoFullName: string | undefined
  try {
    const project = await getProject(projectId)
    repoFullName = project?.repoFullName
  } catch {
    // Non-fatal — repo tools will report "unavailable" to the model.
  }

  return { conversation, messages, intelBlock, repoFullName }
}

/** Persist the assistant reply + merged preview patch — identical for both transports. */
async function persistArchitectTurnResult(
  conversation: ProjectBuilderConversation,
  reply: string,
  previewPatch: Partial<AgentPreview> | null
): Promise<void> {
  await appendMessage(conversation.id, 'assistant', reply, previewPatch ? { previewUpdated: true } : undefined)

  const merged = mergePreview(conversation.latestPreview, previewPatch)
  const status = merged?.readyForApproval ? 'draft_ready' : conversation.status

  await pgrest('PATCH', `project_builder_conversations?${eq('id', conversation.id)}`, {
    latest_preview: merged,
    status,
    updated_at: new Date().toISOString(),
  })
}

export async function postProjectBuilderMessage(
  projectId: string,
  content: string
): Promise<ProjectBuilderConversationBundle> {
  const { conversation, messages, intelBlock, repoFullName } = await prepareArchitectTurnContext(projectId, content)

  const { reply, previewPatch } = await generateArchitectTurn({
    messages,
    repoContext: intelBlock,
    currentPreview: conversation.latestPreview,
    repoFullName,
  })

  await persistArchitectTurnResult(conversation, reply, previewPatch)

  return getProjectBuilderConversationBundle(projectId)
}

/**
 * Streaming counterpart of `postProjectBuilderMessage`: persists the user
 * turn and resolves the same context, but runs the architect loop with
 * `streamArchitectTurn` so `onToken` fires for every prose delta as it
 * arrives. Persistence of the final assistant message + preview patch happens
 * ONCE, after the full reply has been accumulated — identical write pattern
 * to the non-streaming path, so both leave the conversation in the same
 * state. Returns the full bundle so the route can send a final SSE event with
 * the resolved preview/messageId, matching what the JSON endpoint returns.
 */
export async function postProjectBuilderMessageStream(
  projectId: string,
  content: string,
  onToken: (delta: string) => void
): Promise<ProjectBuilderConversationBundle> {
  const { conversation, messages, intelBlock, repoFullName } = await prepareArchitectTurnContext(projectId, content)

  const { reply, previewPatch } = await streamArchitectTurn(
    {
      messages,
      repoContext: intelBlock,
      currentPreview: conversation.latestPreview,
      repoFullName,
    },
    onToken
  )

  await persistArchitectTurnResult(conversation, reply, previewPatch)

  return getProjectBuilderConversationBundle(projectId)
}

export async function selectProjectBuilderPreviewOption(
  projectId: string,
  optionId: string
): Promise<ProjectBuilderConversationBundle> {
  const conversation = await ensureActiveProjectBuilderConversation(projectId)
  const next = selectPreviewOption(conversation.latestPreview, optionId)
  if (!next) throw new Error('preview option not found')

  await pgrest('PATCH', `project_builder_conversations?${eq('id', conversation.id)}`, {
    latest_preview: next,
    updated_at: new Date().toISOString(),
  })

  await appendMessage(
    conversation.id,
    'system',
    `Selected preview option: ${optionId}`,
    { selectedOptionId: optionId }
  )

  return getProjectBuilderConversationBundle(projectId)
}

function previewToManifestDraft(preview: AgentPreview): BuilderManifestDraft {
  return {
    name: preview.name,
    description: preview.description ?? preview.role,
    suggestedRuntime: 'langgraph',
    suggestedModel: 'gpt-5.4',
    systemPromptSummary: preview.systemPromptSummary ?? preview.role ?? preview.description,
    confirmationPolicy: preview.confirmationPolicy ?? 'risky-only',
    maxStepsPerRun: preview.maxStepsPerRun ?? 12,
    forbiddenActions: [
      'auto-promote to production',
      'push to external repos without explicit human approval',
      'mount write-capable tools without confirmation',
    ],
  }
}

function previewToTools(preview: AgentPreview): BuilderProposedTool[] {
  if (preview.proposedTools?.length) {
    return preview.proposedTools.map((t) => ({
      name: t.name,
      riskLevel: t.riskLevel,
      requiresConfirmation: t.requiresConfirmation,
      provider: 'internal',
    }))
  }
  return (preview.tools ?? []).map((name) => ({
    name,
    riskLevel: 'low',
    requiresConfirmation: false,
    provider: 'internal',
  }))
}

function buildMaterializationPrompt(preview: AgentPreview): string {
  return (
    `Materialize a repo-aware draft copilot for this project with EXACTLY this approved spec:\n` +
    `Name: ${preview.name}\nRole: ${preview.role ?? preview.description ?? ''}\n` +
    `System prompt summary: ${preview.systemPromptSummary ?? preview.role ?? ''}\n` +
    `Tools (read-only first): ${(preview.tools ?? preview.proposedTools?.map((t) => t.name) ?? []).join(', ')}\n` +
    `Tests: ${(preview.tests ?? preview.testCases?.map((t) => t.name) ?? []).join('; ')}\n` +
    `Risk policy: ${preview.riskPolicy ?? 'read-only, human approval before any write'}\n` +
    `Use draft_copilot_spec when ready and pause for human approval before persisting anything.`
  )
}

async function resolveBuilderCopilotId(): Promise<string> {
  const rows = await pgrest<{ id: string }[]>(
    'GET',
    `copilots?select=id&slug=eq.${encodeURIComponent(AGENT_BUILDER_SLUG)}&limit=1`
  )
  if (!rows[0]) throw new Error('Agent Builder is not provisioned')
  return rows[0].id
}

/**
 * True when `err` is the LangGraph SDK's HTTPError (or any error carrying a
 * numeric `status`) for HTTP 404 specifically — "the resource doesn't exist"
 * as opposed to a transport failure / 5xx ("the server is down"). Same
 * duck-typing as langgraph-explorer.ts's isNotFoundError / resolve-run-
 * assistant.ts's isNotFound — kept local since this module doesn't otherwise
 * import either of those.
 */
function isNotFoundError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'status' in err && (err as { status: unknown }).status === 404
}

/**
 * Liveness check for a conversation's stored `langgraph_thread_id` — the SAME
 * pattern as resolve-run-assistant.ts's ensureCopilotAssistantIsLive, applied
 * to threads instead of assistants. The `langgraphjs dev` Agent Server keeps
 * threads IN MEMORY; a server restart (crash, redeploy) wipes them while the
 * DB still holds the thread id, and the conversation looks like it has a
 * materialization "in progress" forever. Before trusting a stored thread id
 * as proof of an in-flight run, verify it still exists on the Agent Server:
 *  - thread found → truly in progress, caller should refuse to start another.
 *  - 404 → stale/orphaned id from a wiped in-memory store: clear it in DB and
 *    tell the caller it's safe to re-arm.
 *  - any other error (network/5xx — the server itself is unreachable) →
 *    propagate; we don't know the thread's real state, so don't guess by
 *    clearing it.
 */
async function ensureConversationThreadIsLive(conversation: ProjectBuilderConversation): Promise<boolean> {
  const threadId = conversation.langgraphThreadId
  if (!threadId) return false

  try {
    await agentServerClient().threads.get(threadId)
    return true
  } catch (err) {
    if (!isNotFoundError(err)) throw err
    console.warn(
      `[project-builder] stale langgraph_thread_id ${threadId} on conversation ${conversation.id} (404 on Agent Server) — clearing and re-arming`
    )
    await pgrest('PATCH', `project_builder_conversations?${eq('id', conversation.id)}`, {
      langgraph_thread_id: null,
      updated_at: new Date().toISOString(),
    })
    return false
  }
}

/**
 * Reconstruct the run state for the bundle handed to the workbench on
 * load/reload. This is the fix for the reload race: "Approve — create draft"
 * starts a LangGraph run and stores its thread id, but a page reload had no
 * way to know a run was already paused at the interrupt — it re-showed
 * "Approve", the operator re-clicked it, and `startProjectBuilderDraftMaterialization`
 * threw "draft materialization already in progress" (the guard IS correct;
 * the UI just never learned the true state to avoid hitting it).
 *
 * Three outcomes, matching `ensureConversationThreadIsLive`'s cases so the
 * two never disagree about the same thread:
 *  - no `langgraphThreadId` at all → nothing running, `null`.
 *  - thread is dead (404 on the Agent Server, e.g. server restart wiped its
 *    in-memory store) → `ensureConversationThreadIsLive` already clears the
 *    stale id in the DB and re-arms the conversation; this function mirrors
 *    that same mutation onto the in-memory `conversation` it was handed (the
 *    caller's copy predates the PATCH) so the returned bundle can't show a
 *    stale non-null `langgraphThreadId` next to a `null` runState. Returns
 *    `null` runState so the UI falls back to "Approve" (correct: the run
 *    really is gone).
 *  - thread is live → read its normalized state via `getAgentBuilderRunState`
 *    (same source of truth `startProjectBuilderDraftMaterialization` /
 *    `confirmProjectBuilderDraftMaterialization` produce) so the UI can show
 *    "Confirm draft" when `status === 'awaiting_approval'`.
 *  - liveness check itself fails (5xx/network — Agent Server unreachable) →
 *    swallow and return `null`. We don't know the thread's real state; a
 *    transient outage must not make the bundle load fail, and guessing
 *    "awaiting" would let the UI show "Confirm" for a run that may not exist,
 *    while guessing "not running" risks the same double-click 502 this fix
 *    targets. `null` is the conservative choice already used elsewhere in
 *    this file for non-fatal lookups (repo intelligence, project lookup).
 *
 * Mutates `conversation` in place (single-owner local object, not shared) so
 * the caller's copy reflects the same clear-on-404 the DB just received.
 */
async function reconstructRunState(conversation: ProjectBuilderConversation): Promise<BuilderRunState | null> {
  if (!conversation.langgraphThreadId) return null
  const threadId = conversation.langgraphThreadId

  let live: boolean
  try {
    live = await ensureConversationThreadIsLive(conversation)
  } catch (err) {
    console.warn(
      `[project-builder] could not verify langgraph_thread_id ${threadId} liveness for conversation ${conversation.id} (Agent Server unreachable) — reporting no run state`,
      err
    )
    return null
  }
  if (!live) {
    // ensureConversationThreadIsLive already cleared the stale id in the DB on
    // 404 — mirror that here so the bundle's `conversation` doesn't disagree
    // with its own `runState: null`.
    conversation.langgraphThreadId = null
    return null
  }

  try {
    return await getAgentBuilderRunState(threadId)
  } catch (err) {
    console.warn(
      `[project-builder] getAgentBuilderRunState failed for thread ${threadId} on conversation ${conversation.id}`,
      err
    )
    return null
  }
}

/** Start LangGraph materialization from an approved preview (no DB copilot yet). */
export async function startProjectBuilderDraftMaterialization(projectId: string) {
  const conversation = await ensureActiveProjectBuilderConversation(projectId)
  if (await ensureConversationThreadIsLive(conversation)) {
    throw new Error('draft materialization already in progress')
  }
  const guard = canStartDraftMaterialization(conversation.latestPreview)
  if (!guard.ok) throw new Error(guard.reason)

  const preview = conversation.latestPreview!
  const project = await getProject(projectId)
  if (!project) throw new Error('project not found')

  let repoScan: { repo: string; branch: string; scripts: Record<string, string> } | null = null
  let repoContext: string | undefined
  if (project.repoFullName && process.env.GITHUB_TOKEN) {
    try {
      const scan = await scanProjectRepo(project)
      repoScan = { repo: scan.repo, branch: scan.branch, scripts: scan.scripts }
      repoContext = repoScanToContext(scan)
    } catch {
      // Non-fatal.
    }
  }

  const builderCopilotId = await resolveBuilderCopilotId()
  const runState = await startAgentBuilderRun({
    copilotId: builderCopilotId,
    userInput: buildMaterializationPrompt(preview),
    projectId,
    repoContext,
    repoScan,
  })

  await pgrest('PATCH', `project_builder_conversations?${eq('id', conversation.id)}`, {
    langgraph_thread_id: runState.runId,
    status: 'draft_ready',
    updated_at: new Date().toISOString(),
  })

  return { conversationId: conversation.id, runState }
}

/**
 * Confirm LangGraph HITL and persist draft copilot (existing validated pipeline).
 */
export async function confirmProjectBuilderDraftMaterialization(
  projectId: string,
  approved: boolean
): Promise<{
  createdCopilotId: string | null
  assistantId: string | null
  runState: Awaited<ReturnType<typeof resumeAgentBuilderRun>>
}> {
  const conversation = await ensureActiveProjectBuilderConversation(projectId)
  const threadId = conversation.langgraphThreadId
  if (!threadId) throw new Error('no LangGraph run in progress — start draft materialization first')

  const project = await getProject(projectId)
  if (!project) throw new Error('project not found')

  let repoScan: { repo: string; branch: string; scripts: Record<string, string> } | null = null
  if (project.repoFullName && process.env.GITHUB_TOKEN) {
    try {
      const scan = await scanProjectRepo(project)
      repoScan = { repo: scan.repo, branch: scan.branch, scripts: scan.scripts }
    } catch {
      // Non-fatal.
    }
  }

  const builderCopilotId = await resolveBuilderCopilotId()
  const runState = await resumeAgentBuilderRun({
    copilotId: builderCopilotId,
    runId: threadId,
    approved,
    projectId,
    repoScan,
  })

  if (!approved || !runState.manifestDraft) {
    return { createdCopilotId: null, assistantId: null, runState }
  }

  const preview = conversation.latestPreview
  const draft = runState.manifestDraft ?? (preview ? previewToManifestDraft(preview) : null)
  const tools = runState.selectedTools.length > 0 ? runState.selectedTools : preview ? previewToTools(preview) : []

  if (!draft) throw new Error('no manifest draft to materialize')

  const createInput = draftToCreateInput(draft, tools, projectId)
  const createdCopilotId = await createCopilotFromManifest(createInput)

  // Provision the copilot's dedicated assistant and persist its id. On failure,
  // roll back best-effort (assistant then copilot cascade) so no half-wired
  // copilot survives — mirrors POST /api/agent-ops/copilots.
  let assistantId: string
  try {
    assistantId = await ensureCopilotAssistant({ copilotId: createdCopilotId })
  } catch (err) {
    console.error('[project-builder] ensureCopilotAssistant failed:', err)
    await deleteCopilotCascade(createdCopilotId).catch(() => {})
    throw err
  }

  try {
    await setCopilotAssistantId(createdCopilotId, assistantId)
  } catch (err) {
    // The copilot exists but couldn't be linked to its assistant — undo both so
    // no orphan/unlinked copilot survives.
    console.error('[project-builder] setCopilotAssistantId failed:', err)
    await deleteCopilotAssistant(assistantId).catch(() => {})
    await deleteCopilotCascade(createdCopilotId).catch(() => {})
    throw err
  }

  const now = new Date().toISOString()
  await pgrest('PATCH', `project_builder_conversations?${eq('id', conversation.id)}`, {
    status: 'draft_created',
    langgraph_thread_id: null,
    latest_preview: {
      ...(preview ?? {}),
      createdCopilotId,
    },
    updated_at: now,
  })

  await appendMessage(
    conversation.id,
    'assistant',
    `Draft prepared and attached to this project. Copilot id: ${createdCopilotId}. Not in production.`,
    { createdCopilotId }
  )

  return { createdCopilotId, assistantId, runState }
}
