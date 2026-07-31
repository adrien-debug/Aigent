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

import { randomUUID } from 'node:crypto'

import type { CreateCopilotInput, ProposedTool } from './authoring-types'
import { agentServerClient, agentServerUrl, AGENT_BUILDER_GRAPH_ID } from './langgraph-client'
import { runOnAgentServer, resumeOnAgentServer, type LangGraphServerStep } from './langgraph-server'
import { resolveRunAssistantId } from './resolve-run-assistant'
import { slugify } from './slug'
import { augmentProposedToolsWithRepoRead } from './repo-read-tools'
import type { AgentSkill, ConfirmationPolicy, ToolRiskLevel } from './types'

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
  skills?: AgentSkill[]
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

/**
 * A repo-aware release proposal: what the drafted agent proposes to add, why,
 * the risks, the validation commands (derived from the repo's real scripts), and
 * a PR title/body — WITHOUT ever pushing. PR creation is deliberately deferred
 * (`prCreation: 'ships-next'`): this lot never writes to GitHub.
 */
export interface BuilderReleaseProposal {
  /** Files the agent would add on approval + push (scaffold — not written here). */
  proposedFiles: { path: string; why: string }[]
  risks: string[]
  /** Validation commands to run before shipping — real repo scripts when scanned. */
  validationCommands: string[]
  branch: string
  prTitle: string
  prBody: string
  /** Always 'ships-next' in this lot — no GitHub write route is armed here. */
  prCreation: 'ships-next'
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
  /** The project this run is scoped to (repo-aware flow), else null. */
  projectId: string | null
  /** Repo-aware release proposal, present once a draft exists. Never pushes. */
  releaseProposal: BuilderReleaseProposal | null
  /**
   * LangGraph debug metadata — where this run actually executes, so the operator
   * can correlate the Aigent UI with the LangGraph Agent Server. All non-secret.
   */
  langgraph: {
    /** The graph id in langgraph.json — always 'agent_builder'. */
    graph: string
    /** The assistant the run targeted, or null when it ran on the bare graph id. */
    assistantId: string | null
    /** The Agent Server base URL (localhost dev by default). */
    agentServerUrl: string
    /** The thread id — identical to runId; the run's state key on the server. */
    threadId: string
  }
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
  /** When set, the run is scoped to this project (repo-aware flow). */
  projectId?: string
  /** Read-only repo scan context (from repoScanToContext) prepended to the ask. */
  repoContext?: string
  /** The structured scan (repo/branch/scripts) — drives the release proposal's real gates. */
  repoScan?: { repo: string; branch: string; scripts: Record<string, string> } | null
}): Promise<BuilderRunState> {
  // Resolve the copilot's OWN assistant (its config carries the builder's tools
  // + system prompt); falls back to the shared graph id inside runOnAgentServer.
  let assistantId: string | undefined
  try {
    assistantId = await resolveRunAssistantId(args.copilotId)
  } catch {
    // Non-fatal — the shared graph id is used, which still runs the builder.
  }

  // Prepend the repo context (if any) so the graph reasons about the REAL repo:
  // its stack, scripts/gates, routes. The context is a bounded, secret-free
  // summary (repo-scan.ts), never the raw tree.
  const userInput = args.repoContext
    ? `${args.repoContext}\n\nUsing the repo context above, ${args.userInput}`
    : args.userInput

  const result = await runOnAgentServer({
    assistantId,
    userInput,
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
    projectId: args.projectId ?? null,
    repoScan: args.repoScan ?? null,
    assistantId: assistantId ?? null,
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
  /** The project the run is scoped to (repo-aware flow), threaded to the state. */
  projectId?: string
  /** The structured scan — keeps the release proposal's gates real on resume too. */
  repoScan?: { repo: string; branch: string; scripts: Record<string, string> } | null
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
    projectId: args.projectId ?? null,
    repoScan: args.repoScan ?? null,
    assistantId: assistantId ?? null,
  })
}

/**
 * True when `err` is the LangGraph SDK's HTTPError (or any error carrying a
 * numeric `status`) for HTTP 404 specifically — "the thread doesn't exist" as
 * opposed to a transport failure / 5xx ("the server is down"). Same
 * duck-typing as langgraph-explorer.ts's isNotFoundError / resolve-run-
 * assistant.ts's isNotFound — kept local since neither module exports it.
 */
function isNotFoundError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'status' in err && (err as { status: unknown }).status === 404
}

/**
 * Read the current state of a builder run from its thread (source of truth on
 * the Agent Server). Rebuilds the timeline + draft from the accumulated
 * messages, and re-derives whether it is still awaiting approval. Returns null
 * ONLY when the server confirms the thread is unknown (404) — a transport
 * failure or 5xx (server down) is rethrown so the caller returns an honest
 * 502 instead of a lying 404.
 */
export async function getAgentBuilderRunState(runId: string): Promise<BuilderRunState | null> {
  const c = agentServerClient()
  let state: { values?: unknown; tasks?: unknown[] }
  try {
    state = await c.threads.getState(runId)
  } catch (err) {
    if (isNotFoundError(err)) return null
    throw err
  }

  const messages = ((state.values as { messages?: AnyMsg[] } | undefined)?.messages ?? []) as AnyMsg[]
  const interrupts = ((state.tasks ?? []) as { interrupts?: unknown[] }[]).flatMap((t) => t.interrupts ?? [])
  const interrupted = interrupts.length > 0

  const steps = buildEventsFromMessages(messages)
  const lastAi = messages.toReversed().find((m) => (m.type ?? m.role) === 'ai' || (m.type ?? m.role) === 'assistant')
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
  /** Project scope (repo-aware flow), else null. */
  projectId?: string | null
  /** Repo scan the run was seeded with — drives the release proposal's real scripts. */
  repoScan?: { repo: string; branch: string; scripts: Record<string, string> } | null
  /** The assistant the run targeted (null → bare graph id). For the debug block. */
  assistantId?: string | null
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
        skills: draft.skills,
        maxStepsPerRun: draft.maxStepsPerRun,
        maxCostPerRunUsd: draft.maxCostPerRunUsd,
      }
    : null

  // Release proposal — only meaningful once a draft exists. Never pushes; PR
  // creation is deferred (ships-next) since no GitHub write route is armed here.
  const releaseProposal: BuilderReleaseProposal | null = manifestDraft
    ? buildReleaseProposal(manifestDraft, risks, input.repoScan ?? null)
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
    projectId: input.projectId ?? null,
    releaseProposal,
    langgraph: {
      graph: AGENT_BUILDER_GRAPH_ID,
      assistantId: input.assistantId ?? null,
      agentServerUrl: agentServerUrl(),
      threadId: input.runId,
    },
  }
}

/**
 * Derive a repo-aware release proposal from the drafted manifest + the repo
 * scan. The validation commands are the repo's REAL npm scripts when a scan is
 * present (verify/typecheck/lint/test/build in run
 * order), else a sensible default set. It proposes the SAME scaffold files
 * github.ts would push (handler.ts / manifest.json / README.md under
 * agents/<slug>) — but NOTHING is written: prCreation is 'ships-next'.
 */
function buildReleaseProposal(
  draft: BuilderManifestDraft,
  risks: string[],
  scan: { repo: string; branch: string; scripts: Record<string, string> } | null
): BuilderReleaseProposal {
  const slug = (draft.name ?? 'drafted-copilot')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const dir = `agents/${slug || 'drafted-copilot'}`

  // Prefer the repo's real gate order when scanned; else a safe default.
  const GATE_ORDER = ['verify', 'typecheck', 'lint', 'test', 'build']
  const scriptNames = scan ? Object.keys(scan.scripts) : []
  const validationCommands =
    scriptNames.length > 0
      ? GATE_ORDER.filter((g) => scriptNames.includes(g)).map((g) => `npm run ${g}`)
      : ['npm run verify']
  if (validationCommands.length === 0) validationCommands.push('npm run verify')

  const branch = `agent/${slug || 'drafted-copilot'}`

  return {
    proposedFiles: [
      { path: `${dir}/handler.ts`, why: 'Runnable agent entry point (reads OPENAI_API_KEY at runtime; no secret embedded).' },
      { path: `${dir}/manifest.json`, why: 'Serialized manifest — prompt, guardrails, allowed routes, cost/step limits.' },
      { path: `${dir}/README.md`, why: 'How to run the agent + its guardrails, for repo contributors.' },
    ],
    risks:
      risks.length > 0
        ? risks
        : ['Read-only agent — no destructive actions proposed. Human approval required before any push.'],
    validationCommands,
    branch,
    prTitle: `feat(agents): add ${draft.name ?? 'drafted copilot'}`,
    prBody: [
      `Adds the **${draft.name ?? 'drafted copilot'}** agent scaffold under \`${dir}\`.`,
      '',
      draft.description ? `> ${draft.description}` : '',
      '',
      scan ? `Scoped to \`${scan.repo}\` (branch \`${scan.branch}\`).` : '',
      '',
      '## Validation',
      validationCommands.map((c) => `- [ ] \`${c}\` passes`).join('\n'),
      '',
      '## Guardrails',
      '- Read-only tools only; no destructive/write tool without confirmation.',
      '- Never auto-promotes to production; never force-pushes.',
      '',
      '_Prepared by Agent Builder. No code was pushed — this PR ships on explicit approval._',
    ]
      .filter((l) => l !== '')
      .join('\n'),
    prCreation: 'ships-next',
  }
}

/**
 * Map a builder draft into the authoring `CreateCopilotInput`. Shared by the
 * bench flow (architect/resume — projectId null) and the repo-aware flow
 * (projects/[id]/builder/resume — projectId set so the draft is ATTACHED to the
 * project). Always a DRAFT: never production, never auto-assigned targets. A
 * random-suffixed slug avoids colliding with an earlier draft of the same name.
 */
export function draftToCreateInput(
  draft: BuilderManifestDraft,
  tools: BuilderProposedTool[],
  projectId: string | null = null
): CreateCopilotInput {
  const name = draft.name?.trim() || 'Drafted Copilot'
  const roleText = `${draft.systemPromptSummary ?? ''} ${draft.description ?? ''}`
  const rawProposed: ProposedTool[] = tools.map((t) => ({
    name: t.name,
    description: `${t.name} — proposed by Agent Builder`,
    provider: normalizeProvider(t.provider),
    riskLevel: normalizeRisk(t.riskLevel),
    requiresConfirmation: t.requiresConfirmation === true,
  }))
  const proposedTools = augmentProposedToolsWithRepoRead(rawProposed, roleText, projectId !== null)

  // allowedRoutes: the benchmark judge counts any surface an agent acts on (or
  // cites) outside this list as an unauthorizedRoute violation. The old
  // hardcoded ['/admin/agents', '/admin/agents/*'] fallback was the Agent
  // Builder Copilot's OWN surface, never the drafted agent's — so every
  // legitimate data read (e.g. /api/market/prices) was scored as a violation
  // and benchmark scores collapsed (observed: 21–44/100 instead of ~89 on the
  // TradeAgent wave, 2026-07-16). Derive the list from the draft instead:
  // route-shaped tool names (the builder names data tools by their endpoint),
  // widened to a '/*' pattern per top segment so sibling reads under the same
  // family aren't violations either. Empty derivation → [] (no route claims),
  // NEVER the builder's own admin surface.
  const derivedRoutes = deriveAllowedRoutesFromTools(proposedTools.map((t) => t.name))

  return {
    name,
    slug: `${slugify(name)}-draft-${randomUUID().replace(/-/g, '').slice(0, 8)}`,
    description: draft.description?.trim() || 'Drafted by Agent Builder Copilot, awaiting human review.',
    runtime: 'langgraph',
    model: draft.suggestedModel?.trim() || 'gpt-5.4',
    modelProvider: 'openai',
    owner: 'agent-builder',
    // 'bench' tag only when unattached; a project-scoped draft is not on the bench.
    tags: projectId ? ['drafted', 'agent-builder', 'repo-aware'] : ['drafted', 'agent-builder', 'bench'],
    // Attach to the project when repo-aware; else stay on the bench. Never production.
    projectId,
    targetProjectIds: [],
    manifest: {
      systemPromptSummary:
        draft.systemPromptSummary?.trim() || `${name}: ${draft.description ?? ''} Operates read-only, human-in-the-loop.`,
      allowedRoutes: draft.allowedRoutes ?? derivedRoutes,
      forbiddenActions: draft.forbiddenActions ?? [
        'auto-promote to production',
        'push to external repos',
        'create write-capable tools without requiresConfirmation and a risk flag',
        'bypass any confirmation prompt or promotion gate',
      ],
      confirmationPolicy: normalizePolicy(draft.confirmationPolicy),
      alwaysConfirmActions: ['create a draft copilot', 'run a benchmark', 'prepare a production promotion'],
      outputContract: {
        format: 'markdown',
        schemaName: null,
        invariants: ['never promotes to production autonomously', 'prefers read-only, least-privilege proposals'],
      },
      proposedTools,
      skills: draft.skills ?? [],
      maxStepsPerRun: draft.maxStepsPerRun ?? 12,
      maxCostPerRunUsd: draft.maxCostPerRunUsd ?? 0.5,
    },
  }
}

/**
 * Derive manifest allowedRoutes from the draft's tool names. The builder names
 * data tools by the endpoint they read (e.g. '/api/market/prices'), so every
 * route-shaped name yields itself PLUS a '/<seg1>/<seg2>/*' family pattern
 * (e.g. '/api/market/*') — sibling reads in the same family are then in-scope
 * for the benchmark judge instead of counting as unauthorizedRoute violations.
 * Non-route tool names (read_repo_file, search_repo…) contribute nothing.
 * Deduplicated, order-stable. No route-shaped tools → [].
 */
function deriveAllowedRoutesFromTools(toolNames: string[]): string[] {
  const routes = new Set<string>()
  for (const name of toolNames) {
    const trimmed = name.trim()
    // Route-shaped: starts with '/', at least one segment, no whitespace.
    if (!/^\/[A-Za-z0-9_\-/[\]]+$/.test(trimmed)) continue
    // Canonicalize on segments so '//api//x' and '/api/market/' never leak a
    // doubled or trailing slash into the manifest — one form per route.
    const segs = trimmed.split('/').filter(Boolean)
    if (segs.length === 0) continue
    routes.add(`/${segs.join('/')}`)
    if (segs.length >= 2) routes.add(`/${segs[0]}/${segs[1]}/*`)
    else routes.add(`/${segs[0]}/*`)
  }
  return [...routes]
}

function normalizeRisk(r: string | undefined): ToolRiskLevel {
  return r === 'low' || r === 'medium' || r === 'high' || r === 'critical' ? r : 'medium'
}
function normalizeProvider(p: string | undefined): ProposedTool['provider'] {
  return p === 'internal' || p === 'composio' || p === 'mcp' || p === 'http' ? p : 'internal'
}
function normalizePolicy(p: string | undefined): ConfirmationPolicy {
  return p === 'always' || p === 'risky-only' || p === 'never' ? p : 'risky-only'
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

  for (const m of messages.toReversed()) {
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
      skills: skillArray(pm.skills),
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
      const nameFromCall = m.tool_call_id ? nameByCallId.get(m.tool_call_id) : undefined
      const name = m.name ?? nameFromCall ?? 'tool'
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
function skillArray(v: unknown): AgentSkill[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({
      label: String(s.label ?? ''),
      ...(typeof s.detail === 'string' && s.detail.length > 0 ? { detail: s.detail } : {}),
    }))
    .filter((s) => s.label.length > 0)
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
