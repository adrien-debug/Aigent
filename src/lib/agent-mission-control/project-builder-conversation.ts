/**
 * Project Builder — persistent conversation store + architect turns (server only).
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

import type OpenAI from 'openai'

import { AGENT_BUILDER_SLUG } from './agent-builder-copilot'
import {
  draftToCreateInput,
  resumeAgentBuilderRun,
  startAgentBuilderRun,
  type BuilderManifestDraft,
  type BuilderProposedTool,
} from './agent-builder-run'
import { createCopilotFromManifest, setCopilotAssistantId } from './authoring-writes'
import { getProject } from './data'
import { ensureCopilotAssistant } from './langgraph-assistants'
import { getOpenAIClient, ARCHITECT_MODEL } from './llm-client'
import {
  PROJECT_BUILDER_ARCHITECT_SYSTEM,
  PROJECT_BUILDER_PREVIEW_TOOL,
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

export async function ensureActiveProjectBuilderConversation(projectId: string): Promise<ProjectBuilderConversation> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `project_builder_conversations?${eq('project_id', projectId)}&status=in.(active,draft_ready,draft_created)&select=*&order=updated_at.desc&limit=1`
  )
  if (rows[0]) return rowToConversation(rows[0])

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

  return { conversation, messages, repoSummary, createdCopilotId }
}

function parsePreviewToolArgs(raw: string): Partial<AgentPreview> | null {
  try {
    return JSON.parse(raw) as Partial<AgentPreview>
  } catch {
    return null
  }
}

async function generateArchitectTurn(args: {
  messages: ProjectBuilderMessage[]
  repoContext: string
  currentPreview: AgentPreview | null
}): Promise<{ reply: string; previewPatch: Partial<AgentPreview> | null }> {
  const client = getOpenAIClient()
  const recent = args.messages.slice(-MAX_MESSAGES_FOR_LLM)
  const openAiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `${PROJECT_BUILDER_ARCHITECT_SYSTEM}\n\n${args.repoContext}\n\nCurrent preview JSON (may be empty):\n${JSON.stringify(args.currentPreview ?? {})}`,
    },
    ...recent.map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: m.content,
    })),
  ]

  const response = await client.chat.completions.create(
    {
      model: ARCHITECT_MODEL,
      messages: openAiMessages,
      tools: [PROJECT_BUILDER_PREVIEW_TOOL],
      tool_choice: 'auto',
      max_completion_tokens: 4096,
    },
    { timeout: OPENAI_TIMEOUT_MS }
  )

  const msg = response.choices[0]?.message
  if (!msg) throw new Error('architect returned empty completion')

  let previewPatch: Partial<AgentPreview> | null = null
  const toolCall = msg.tool_calls?.find((t) => t.type === 'function' && t.function.name === 'update_preview')
  if (toolCall && toolCall.type === 'function') {
    previewPatch = parsePreviewToolArgs(toolCall.function.arguments)
  }

  const reply =
    (typeof msg.content === 'string' && msg.content.trim().length > 0
      ? msg.content.trim()
      : previewPatch
        ? "I've updated the preview panel with my latest proposal — tell me what to refine."
        : "I'm here to help architect an agent for this repo.") ?? ''

  if (previewPatch && !previewPatch.flow?.length) {
    previewPatch.flow = defaultAgentFlow()
  }

  return { reply, previewPatch }
}

export async function postProjectBuilderMessage(
  projectId: string,
  content: string
): Promise<ProjectBuilderConversationBundle> {
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

  const { reply, previewPatch } = await generateArchitectTurn({
    messages,
    repoContext: intelBlock,
    currentPreview: conversation.latestPreview,
  })

  await appendMessage(conversation.id, 'assistant', reply, previewPatch ? { previewUpdated: true } : undefined)

  const merged = mergePreview(conversation.latestPreview, previewPatch)
  const status = merged?.readyForApproval ? 'draft_ready' : conversation.status

  await pgrest('PATCH', `project_builder_conversations?${eq('id', conversation.id)}`, {
    latest_preview: merged,
    status,
    updated_at: new Date().toISOString(),
  })

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

/** Start LangGraph materialization from an approved preview (no DB copilot yet). */
export async function startProjectBuilderDraftMaterialization(projectId: string) {
  const conversation = await ensureActiveProjectBuilderConversation(projectId)
  if (conversation.langgraphThreadId) {
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
  const assistantId = await ensureCopilotAssistant({ copilotId: createdCopilotId })
  await setCopilotAssistantId(createdCopilotId, assistantId)

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
