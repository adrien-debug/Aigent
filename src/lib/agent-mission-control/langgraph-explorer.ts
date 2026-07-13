/**
 * Agent Mission Control — LangGraph run explorer (server only, READ-ONLY).
 *
 * Thin, redacting read layer over the LangGraph Agent Server the app actually
 * uses (agent.hearst.app in prod, via `agentServerClient()`). It lists
 * assistants and threads and reads a single thread's state, then maps each
 * response to a SMALL, SAFE shape — never returning the raw server payload,
 * never any header/secret. The `x-agent-key` lives only in the server-side
 * client (langgraph-client.ts); it never crosses into these return values.
 *
 * Strictly read-only: no create/update/delete, no run, no interrupt/resume. If
 * the server is unreachable the SDK throws and the caller maps it to a clean
 * error status.
 *
 * Never import this module from a client component: it uses the authed client.
 */
import 'server-only'

import { agentServerClient, agentServerUrl, AGENT_BUILDER_GRAPH_ID } from './langgraph-client'

/** How many threads to list at most (bounded — this is an operator overview). */
const THREADS_LIMIT = 50
const ASSISTANTS_LIMIT = 100

/** Redacted assistant row for the explorer UI. */
export interface ExplorerAssistant {
  assistantId: string
  name?: string
  graphId?: string
  createdAt?: string
  updatedAt?: string
}

/** Redacted thread/run row for the explorer UI. */
export interface ExplorerThread {
  threadId: string
  status: string
  createdAt?: string
  updatedAt?: string
  assistantId?: string
  graph?: string
}

/** Redacted single-thread detail. */
export interface ExplorerThreadDetail {
  threadId: string
  status: string
  /** The next node(s) the graph would run — null when the run is finished. */
  currentNode: string | null
  /** Interrupt payloads (human-approval questions), if the run is paused. */
  interrupts: unknown[]
  /** The thread's messages (roles + content), redacted of nothing app-secret. */
  messages: { role: string; content: string; toolCalls?: string[] }[]
  /** The dedicated assistant this thread targeted, if recorded in metadata. */
  assistantId?: string
  graph?: string
}

type Row = Record<string, unknown>

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** List the assistants on the Agent Server (redacted). Read-only. */
export async function listAssistants(): Promise<ExplorerAssistant[]> {
  const c = agentServerClient()
  const rows = (await c.assistants.search({ limit: ASSISTANTS_LIMIT })) as unknown as Row[]
  return rows.map((a) => ({
    assistantId: String(a.assistant_id ?? ''),
    name: str(a.name),
    graphId: str(a.graph_id),
    createdAt: str(a.created_at),
    updatedAt: str(a.updated_at),
  }))
}

/** List recent threads/runs on the Agent Server (redacted). Read-only. */
export async function listThreads(): Promise<ExplorerThread[]> {
  const c = agentServerClient()
  const rows = (await c.threads.search({ limit: THREADS_LIMIT })) as unknown as Row[]
  return rows.map((t) => {
    const meta = (t.metadata as Row | undefined) ?? {}
    return {
      threadId: String(t.thread_id ?? ''),
      status: String(t.status ?? 'unknown'),
      createdAt: str(t.created_at),
      updatedAt: str(t.updated_at),
      assistantId: str(meta.assistant_id) ?? str(meta.assistantId),
      graph: str(meta.graph_id) ?? AGENT_BUILDER_GRAPH_ID,
    }
  })
}

/**
 * Read one thread's state (redacted). Returns null when the thread is unknown
 * (404 on the server → the run isn't there / was never created). Read-only.
 */
export async function getThreadDetail(threadId: string): Promise<ExplorerThreadDetail | null> {
  const c = agentServerClient()

  let thread: Row
  try {
    thread = (await c.threads.get(threadId)) as unknown as Row
  } catch {
    return null
  }

  let state: { values?: unknown; next?: unknown; tasks?: unknown[] }
  try {
    state = await c.threads.getState(threadId)
  } catch {
    // The thread row exists but state is unreadable — return a minimal detail.
    return {
      threadId,
      status: String(thread.status ?? 'unknown'),
      currentNode: null,
      interrupts: [],
      messages: [],
      assistantId: undefined,
      graph: AGENT_BUILDER_GRAPH_ID,
    }
  }

  const values = (state.values as { messages?: Row[] } | undefined) ?? {}
  const rawMessages = Array.isArray(values.messages) ? values.messages : []
  const messages = rawMessages.map((m) => {
    const type = String(m.type ?? m.role ?? 'message')
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')
    const toolCalls = Array.isArray(m.tool_calls)
      ? (m.tool_calls as Row[]).map((tc) => String(tc.name ?? 'tool')).filter(Boolean)
      : undefined
    return {
      role: type,
      content: content.length > 4000 ? `${content.slice(0, 4000)}…` : content,
      ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    }
  })

  const next = state.next
  const currentNode = Array.isArray(next) && next.length > 0 ? next.map(String).join(', ') : null
  const interrupts = ((state.tasks ?? []) as { interrupts?: unknown[] }[]).flatMap((t) => t.interrupts ?? [])

  const meta = (thread.metadata as Row | undefined) ?? {}
  return {
    threadId,
    status: String(thread.status ?? 'unknown'),
    currentNode,
    interrupts,
    messages,
    assistantId: str(meta.assistant_id) ?? str(meta.assistantId),
    graph: str(meta.graph_id) ?? AGENT_BUILDER_GRAPH_ID,
  }
}

/** One redacted checkpoint from a thread's history (the run replay). */
export interface ExplorerHistoryStep {
  index: number
  /** The node the graph would run NEXT from this checkpoint (`next`), or null. */
  node: string | null
  /** Whether this checkpoint carries a pending interrupt. */
  interrupted: boolean
  createdAt?: string
  /** Message count at this checkpoint (monotonic — grows through the run). */
  messageCount: number
  /** The last message's role + a short content preview at this checkpoint. */
  lastRole?: string
  lastPreview?: string
  /** Tool names requested by the last AI message at this checkpoint. */
  toolCalls: string[]
  /** Interrupt payloads at this checkpoint (approval questions), redacted. */
  interrupts: unknown[]
}

/**
 * Read a thread's checkpoint HISTORY (the real run trail) from the Agent Server,
 * redacted + ordered OLDEST→NEWEST. Each checkpoint's `next` is the node the
 * graph would run from there — that reconstructs the exact path parcouru. The
 * server returns history newest-first; we reverse it and index from 0.
 *
 * Redaction: only message roles/previews, tool NAMES, `next`, timestamps and the
 * interrupt payloads are surfaced — never the checkpoint metadata (which carries
 * the copilot systemPrompt/tools config), never a raw values blob. Read-only.
 * Returns [] when the server has no history for this thread.
 */
export async function getThreadHistory(threadId: string): Promise<ExplorerHistoryStep[]> {
  const c = agentServerClient()
  let raw: unknown
  try {
    raw = await c.threads.getHistory(threadId, { limit: 40 })
  } catch {
    return []
  }
  const list = (Array.isArray(raw) ? raw : []) as Row[]
  // Server returns newest-first; reverse to oldest-first for a natural replay.
  const ordered = [...list].reverse()

  return ordered.map((cp, index) => {
    const values = (cp.values as { messages?: Row[] } | undefined) ?? {}
    const messages = Array.isArray(values.messages) ? values.messages : []
    const last = messages[messages.length - 1] as Row | undefined
    const lastRole = last ? String(last.type ?? last.role ?? '') : undefined
    const lastContent = last ? (typeof last.content === 'string' ? last.content : JSON.stringify(last.content ?? '')) : ''
    const toolCalls = Array.isArray(last?.tool_calls)
      ? (last!.tool_calls as Row[]).map((tc) => String(tc.name ?? 'tool')).filter(Boolean)
      : []
    const next = cp.next
    const node = Array.isArray(next) && next.length > 0 ? String(next[0]) : null
    const tasks = (cp.tasks as { interrupts?: unknown[] }[] | undefined) ?? []
    const interrupts = tasks.flatMap((t) => t.interrupts ?? [])

    return {
      index,
      node,
      interrupted: interrupts.length > 0,
      createdAt: str(cp.created_at),
      messageCount: messages.length,
      lastRole: lastRole || undefined,
      lastPreview: lastContent ? (lastContent.length > 160 ? `${lastContent.slice(0, 160)}…` : lastContent) : undefined,
      toolCalls,
      interrupts,
    }
  })
}

/** The Agent Server URL + graph the explorer targets (for the UI header + Studio link). */
export function explorerServerInfo(): { agentServerUrl: string; graph: string } {
  return { agentServerUrl: agentServerUrl(), graph: AGENT_BUILDER_GRAPH_ID }
}
