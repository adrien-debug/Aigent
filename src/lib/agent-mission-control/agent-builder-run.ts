/**
 * Agent Mission Control — Agent Builder run orchestration (server only).
 *
 * The Agent Builder Copilot lives on the validation bench (`project_id: null`),
 * so it CANNOT go through `executeCopilotRun` — that path requires a project
 * (agent_runs.project_id is NOT NULL). Instead the builder runs DIRECTLY on the
 * LangGraph Agent Server via the same thin client the rest of the app uses
 * (runOnAgentServer / resumeOnAgentServer), and the Agent Server's THREAD is the
 * run's source of truth (it owns checkpointing + interrupt/resume). The
 * thread_id IS the builder runId — resumable, inspectable, no bespoke runtime.
 *
 * This module ONLY normalizes what the LangGraph thread already produced into
 * the shape the builder UI needs:
 *   runId, status, currentNode, events[], manifestDraft, selectedTools,
 *   testCases, risks, approvalRequired, createdCopilotId?
 *
 * It never fabricates a run, never mocks the graph, never persists a draft
 * copilot without the human approval the graph's `approval` node enforces.
 *
 * The draft (manifest + tools + tests + benchmark plan) is READ from the graph's
 * own `draft_copilot_spec` ToolMessage — the SAME shared builder (draft-spec.mjs)
 * both execution paths use — so the UI shows exactly what the graph produced,
 * not a re-derivation.
 */
import 'server-only'

import { agentServerClient } from './langgraph-client'
import { runOnAgentServer, resumeOnAgentServer, type LangGraphServerStep } from './langgraph-server'
import { resolveRunAssistantId } from './resolve-run-assistant'

/** The Agent Builder's own step budget (mirrors its manifest maxStepsPerRun). */
const AGENT_BUILDER_MAX_STEPS = 12

/** Lifecycle of a builder run, in the mission's vocabulary. */
export type BuilderRunStatus = 'awaiting_approval' | 'completed' | 'blocked' | 'failed' | 'running'

/** One normalized proposed tool in the draft. */
export interface BuilderProposedTool {
  name: string
  riskLevel: string
  requiresConfirmation: boolean
  provider?: string
}

/** One normalized proposed test case in the draft. */
export interface BuilderTestCase {
  name: string
  kind?: string
  expectedBehavior?: string
}

/** The draft copilot spec the graph proposed (parsed from draft_copilot_spec). */
export interface BuilderManifestDraft {
  name?: string
  description?: string
  suggestedRuntime?: string
  suggestedModel?: string
  systemPromptSummary?: string
  allowedRoutes?: string[]
  forbiddenActions?: string[]
  confirmationPolicy?: string
  maxStepsPerRun?: number
  maxCostPerRunUsd?: number
}

/** One timeline event (a node/step the graph produced), UI-safe. */
export interface BuilderEvent {
  kind: LangGraphServerStep['kind']
  title: string
  detail: string
  status: LangGraphServerStep['status']
}

/** The complete normalized state of a builder run for the UI. */
export interface BuilderRunState {
  runId: string
  status: BuilderRunStatus
  currentNode: string
  events: BuilderEvent[]
  manifestDraft: BuilderManifestDraft | null
  selectedTools: BuilderProposedTool[]
  testCases: BuilderTestCase[]
  risks: string[]
  approvalRequired: boolean
  /** The approval question surfaced by the graph's interrupt (only when awaiting). */
  approvalMessage: string | null
  /** The tool awaiting approval (name + args) — only when awaiting. */
  pendingTool: { name: string; argumentsSummary: string; risk?: string } | null
  finalText: string
  /** Set ONLY after a successful approve+resume materializes a draft copilot. */
  createdCopilotId: string | null
}

type AnyMsg = {
  type?: string
  role?: string
  content?: unknown
  name?: string
  tool_call_id?: string
  tool_calls?: { id?: string; name: string; args?: unknown }[]
}

/**
 * Start a new Agent Builder run for the given user request. Runs the real graph
 * to completion OR to the first human-approval interrupt. Returns the normalized
 * state; the returned runId (thread id) resumes it.
 */
export async function startAgentBuilderRun(args: {
  copilotId: string
  userInput: string
}): Promise<BuilderRunState> {
  // Resolve the copilot's OWN assistant (its config carries the builder's tools
  // + system prompt); falls back to the shared graph id inside runOnAgentServer.
  let assistantId: string | undefined
  try {
    assistantId = await resolveRunAssistantId(args.copilotId)
  } catch {
    // Non-fatal — the shared graph id is used, which still runs the builder.
  }

  const result = await runOnAgentServer({
    assistantId,
    userInput: args.userInput,
    maxSteps: AGENT_BUILDER_MAX_STEPS,
  })

  const draft = await readDraftFromThread(result.threadId)
  return normalizeState({
    runId: result.threadId,
    interrupted: result.interrupted,
    budgetExhausted: result.budgetExhausted,
    steps: result.steps,
    finalText: result.finalText,
    approvalMessage: result.interruptMessage,
    pendingTool: result.pendingTool ?? null,
    draft,
    createdCopilotId: null,
  })
}

/**
 * Resume a paused Agent Builder run with the operator's decision. On approve the
 * gated `draft_copilot_spec` tool runs and the draft is produced (still NOT
 * persisted as a copilot — it is a proposal for human review). On reject the
 * tool is blocked and the run ends `blocked`.
 */
export async function resumeAgentBuilderRun(args: {
  copilotId: string
  runId: string
  approved: boolean
}): Promise<BuilderRunState> {
  let assistantId: string | undefined
  try {
    assistantId = await resolveRunAssistantId(args.copilotId)
  } catch {
    // Non-fatal — shared graph id fallback.
  }

  const result = await resumeOnAgentServer({
    assistantId,
    threadId: args.runId,
    approved: args.approved,
    maxSteps: AGENT_BUILDER_MAX_STEPS,
  })

  const draft = await readDraftFromThread(args.runId)
  // On reject, every gated tool call is blocked → the run is blocked.
  const allBlocked = result.toolCalls.length > 0 && result.toolCalls.every((tc) => tc.status === 'blocked')

  return normalizeState({
    runId: args.runId,
    interrupted: result.interrupted,
    budgetExhausted: result.budgetExhausted,
    steps: result.steps,
    finalText: result.finalText,
    approvalMessage: result.interruptMessage,
    pendingTool: result.pendingTool ?? null,
    draft,
    forcedStatus: !args.approved && allBlocked ? 'blocked' : undefined,
    createdCopilotId: null,
  })
}

/**
 * Read the current state of a builder run from its thread (source of truth on
 * the Agent Server). Rebuilds the timeline + draft from the accumulated
 * messages, and re-derives whether it is still awaiting approval.
 */
export async function getAgentBuilderRunState(runId: string): Promise<BuilderRunState | null> {
  const c = agentServerClient()
  let state: { values?: unknown; tasks?: unknown[] }
  try {
    state = await c.threads.getState(runId)
  } catch {
    return null
  }

  const messages = ((state.values as { messages?: AnyMsg[] } | undefined)?.messages ?? []) as AnyMsg[]
  const interrupts = ((state.tasks ?? []) as { interrupts?: unknown[] }[]).flatMap((t) => t.interrupts ?? [])
  const interrupted = interrupts.length > 0

  const steps = buildEventsFromMessages(messages)
  const lastAi = [...messages].reverse().find((m) => (m.type ?? m.role) === 'ai' || (m.type ?? m.role) === 'assistant')
  const finalText = typeof lastAi?.content === 'string' ? stripSentinel(lastAi.content) : ''
  const draft = extractDraft(messages)

  const approvalMessage = interrupted ? interruptMessageOf(interrupts) : null
  const pendingTool = interrupted ? pendingToolOf(interrupts) : null

  return normalizeState({
    runId,
    interrupted,
    budgetExhausted: messages.some((m) => typeof m.content === 'string' && m.content.startsWith(STEP_BUDGET_EXHAUSTED)),
    steps,
    finalText,
    approvalMessage,
    pendingTool,
    draft,
    createdCopilotId: null,
  })
}

// ---------------------------------------------------------------------------
// Normalization internals
// ---------------------------------------------------------------------------

const STEP_BUDGET_EXHAUSTED = 'aigent_step_budget_exhausted'

function stripSentinel(text: string): string {
  return text.startsWith(STEP_BUDGET_EXHAUSTED) ? text.slice(STEP_BUDGET_EXHAUSTED.length).trim() : text
}

/** Map the graph's step kind to the current node name for the timeline. */
function nodeForStep(step: LangGraphServerStep): string {
  switch (step.kind) {
    case 'llm-call':
      return 'agent'
    case 'confirmation':
      return step.status === 'blocked' ? 'human_approval' : 'approval'
    case 'tool-call':
      return 'tools'
    case 'output':
      return 'final_report'
    default:
      return 'agent'
  }
}

interface NormalizeInput {
  runId: string
  interrupted: boolean
  budgetExhausted: boolean
  steps: LangGraphServerStep[] | BuilderEvent[]
  finalText: string
  approvalMessage: string | null
  pendingTool: { name: string; argumentsSummary: string; risk?: string } | null
  draft: BuilderManifestDraft & {
    proposedTools?: BuilderProposedTool[]
    proposedTestCases?: BuilderTestCase[]
    forbiddenActions?: string[]
  } | null
  forcedStatus?: BuilderRunStatus
  createdCopilotId: string | null
}

function normalizeState(input: NormalizeInput): BuilderRunState {
  const events: BuilderEvent[] = input.steps.map((s) => ({
    kind: s.kind,
    title: s.title,
    detail: s.detail,
    status: s.status,
  }))

  const status: BuilderRunStatus = input.forcedStatus
    ? input.forcedStatus
    : input.interrupted
      ? 'awaiting_approval'
      : input.budgetExhausted
        ? 'failed'
        : 'completed'

  const currentNode = input.interrupted
    ? 'human_approval_interrupt'
    : events.length > 0
      ? nodeForStep(events[events.length - 1] as LangGraphServerStep)
      : 'agent'

  const draft = input.draft
  const selectedTools = draft?.proposedTools ?? []
  const testCases = draft?.proposedTestCases ?? []
  // Risks = the draft's forbidden-actions surface (what the copilot is barred
  // from) + a flag for any write/confirmation-required tool it proposes.
  const risks = [
    ...(draft?.forbiddenActions ?? []),
    ...selectedTools
      .filter((t) => t.requiresConfirmation || (t.riskLevel && t.riskLevel !== 'low'))
      .map((t) => `Tool "${t.name}" is ${t.riskLevel ?? 'medium'} risk and requires confirmation`),
  ]

  const manifestDraft: BuilderManifestDraft | null = draft
    ? {
        name: draft.name,
        description: draft.description,
        suggestedRuntime: draft.suggestedRuntime,
        suggestedModel: draft.suggestedModel,
        systemPromptSummary: draft.systemPromptSummary,
        allowedRoutes: draft.allowedRoutes,
        forbiddenActions: draft.forbiddenActions,
        confirmationPolicy: draft.confirmationPolicy,
        maxStepsPerRun: draft.maxStepsPerRun,
        maxCostPerRunUsd: draft.maxCostPerRunUsd,
      }
    : null

  return {
    runId: input.runId,
    status,
    currentNode,
    events,
    manifestDraft,
    selectedTools,
    testCases,
    risks,
    approvalRequired: input.interrupted,
    approvalMessage: input.approvalMessage,
    pendingTool: input.pendingTool,
    finalText: input.finalText,
    createdCopilotId: input.createdCopilotId,
  }
}

/**
 * Read the graph's `draft_copilot_spec` result from the thread and normalize it
 * into the flat draft shape the UI consumes. Returns null when the graph has not
 * (yet) produced a draft (e.g. a pure refusal, or before approval).
 */
async function readDraftFromThread(threadId: string): Promise<NormalizeInput['draft']> {
  const c = agentServerClient()
  try {
    const state = await c.threads.getState(threadId)
    const messages = ((state.values as { messages?: AnyMsg[] } | undefined)?.messages ?? []) as AnyMsg[]
    return extractDraft(messages)
  } catch {
    return null
  }
}

/**
 * Find the most recent `draft_copilot_spec` ToolMessage in the history and flatten
 * its `draft` payload (from draft-spec.mjs's buildCopilotDraft) into the UI shape.
 */
function extractDraft(messages: AnyMsg[]): NormalizeInput['draft'] {
  // Map tool_call_id → tool name so a ToolMessage (which may omit the name) is
  // identifiable as the draft tool's result.
  const nameByCallId = new Map<string, string>()
  for (const m of messages) {
    const type = m.type ?? m.role
    if ((type === 'ai' || type === 'assistant') && Array.isArray(m.tool_calls)) {
      for (const call of m.tool_calls) if (call.id) nameByCallId.set(call.id, call.name)
    }
  }

  for (const m of [...messages].reverse()) {
    const type = m.type ?? m.role
    if (type !== 'tool') continue
    const name = m.name ?? (m.tool_call_id ? nameByCallId.get(m.tool_call_id) : undefined)
    if (name !== 'draft_copilot_spec') continue
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    let parsed: { ok?: boolean; draft?: Record<string, unknown> }
    try {
      parsed = JSON.parse(content)
    } catch {
      return null
    }
    const d = parsed.draft
    if (!d || typeof d !== 'object') return null

    const pm = (d.proposedManifest as Record<string, unknown>) ?? {}
    return {
      name: str(d.name),
      description: str(d.description),
      suggestedRuntime: str(d.suggestedRuntime),
      suggestedModel: str(d.suggestedModel),
      systemPromptSummary: str(pm.systemPromptSummary),
      allowedRoutes: strArray(pm.allowedRoutes),
      forbiddenActions: strArray(pm.forbiddenActions),
      confirmationPolicy: str(pm.confirmationPolicy),
      maxStepsPerRun: num(pm.maxStepsPerRun),
      maxCostPerRunUsd: num(pm.maxCostPerRunUsd),
      proposedTools: toolArray(d.proposedTools),
      proposedTestCases: testArray(d.proposedTestCases),
    }
  }
  return null
}

// --- Thread-state timeline (mirrors buildStepsFromMessages, builder-flavoured) ---

function buildEventsFromMessages(messages: AnyMsg[]): BuilderEvent[] {
  const nameByCallId = new Map<string, string>()
  for (const m of messages) {
    const type = m.type ?? m.role
    if ((type === 'ai' || type === 'assistant') && Array.isArray(m.tool_calls)) {
      for (const call of m.tool_calls) if (call.id) nameByCallId.set(call.id, call.name)
    }
  }
  const events: BuilderEvent[] = []
  for (const m of messages) {
    const type = m.type ?? m.role
    if (type === 'ai' || type === 'assistant') {
      const requested = (m.tool_calls ?? []).length
      events.push({
        kind: 'llm-call',
        title: 'LLM call · agent',
        detail: requested > 0 ? `requested ${requested} tool call(s)` : 'reasoning / answer',
        status: 'ok',
      })
    } else if (type === 'tool') {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      let blocked = false
      try {
        const parsed = JSON.parse(content) as { ok?: boolean; blocked?: boolean }
        blocked = parsed.blocked === true || parsed.ok === false
      } catch {
        /* non-JSON — treat as ok */
      }
      const name = m.name ?? (m.tool_call_id ? nameByCallId.get(m.tool_call_id) : undefined) ?? 'tool'
      events.push({
        kind: blocked ? 'confirmation' : 'tool-call',
        title: `${blocked ? 'Blocked' : 'Tool'} · ${name}`,
        detail: content.length > 220 ? `${content.slice(0, 219)}…` : content,
        status: blocked ? 'blocked' : 'ok',
      })
    }
  }
  return events
}

function interruptMessageOf(interrupts: unknown[]): string | null {
  const v = (interrupts[0] as { value?: unknown })?.value
  if (v && typeof v === 'object' && 'message' in v) return String((v as { message: unknown }).message)
  return typeof v === 'string' ? v : null
}

function pendingToolOf(interrupts: unknown[]): { name: string; argumentsSummary: string; risk?: string } | null {
  const v = (interrupts[0] as { value?: unknown })?.value
  if (!v || typeof v !== 'object') return null
  const { action, risk, proposed } = v as { action?: unknown; risk?: unknown; proposed?: unknown }
  if (typeof action !== 'string' || !action) return null
  return { name: action, argumentsSummary: JSON.stringify(proposed ?? {}), risk: typeof risk === 'string' ? risk : undefined }
}

// --- Small coercion helpers (never throw; drop malformed fields) ------------

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}
function strArray(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined
}
function toolArray(v: unknown): BuilderProposedTool[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t) => ({
      name: String(t.name ?? 'tool'),
      riskLevel: String(t.riskLevel ?? 'low'),
      requiresConfirmation: t.requiresConfirmation === true,
      provider: typeof t.provider === 'string' ? t.provider : undefined,
    }))
}
function testArray(v: unknown): BuilderTestCase[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t) => ({
      name: String(t.name ?? 'case'),
      kind: typeof t.kind === 'string' ? t.kind : undefined,
      expectedBehavior: typeof t.expectedBehavior === 'string' ? t.expectedBehavior : undefined,
    }))
}
