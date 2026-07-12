/**
 * Agent Mission Control — per-project LangGraph assistant lifecycle (server only).
 *
 * Every Aigent project owns a dedicated ASSISTANT on the shared `agent_builder`
 * graph of the LangGraph Agent Server. An assistant is a named, metadata-tagged
 * configuration of that one graph — so creating N projects yields N distinct
 * entities in LangGraph Studio (each inspectable on its own), while they all
 * still run the single shared graph. Runs for a copilot attached to a project
 * are dispatched against that project's assistant (see runner.ts), not the bare
 * graph id.
 *
 * This module owns only the assistant side. Persisting the returned id onto the
 * `projects` row is the caller's job (authoring-writes.setProjectAssistantId),
 * so the assistant lifecycle and the DB write stay independently testable.
 *
 * Auth/URL come from the shared client factory (langgraph-client.ts) — the same
 * fail-closed `x-agent-key` contract the run/resume path uses, never duplicated.
 *
 * Never import this module from a client component: it builds a server client
 * that carries LANGGRAPH_SERVER_SECRET.
 */
import 'server-only'

import { createHash } from 'node:crypto'

import { agentServerClient, AGENT_BUILDER_GRAPH_ID } from './langgraph-client'

/**
 * Fixed namespace UUID for deriving a project's assistant id. Any constant UUID
 * works — it only has to be stable so the same projectId always maps to the same
 * assistant id across retries.
 */
const ASSISTANT_ID_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'

/**
 * Deterministic RFC-4122 v5 (SHA-1) UUID from `${namespace}:${projectId}`.
 * `ensureProjectAssistant` passes this as the assistant id so that
 * `ifExists: 'do_nothing'` actually collides on a retry (same projectId → same
 * id) instead of minting a fresh UUID every call. The Agent Server keys
 * conflict on the id, so this is what makes creation idempotent per project.
 */
function assistantIdForProject(projectId: string): string {
  const ns = Buffer.from(ASSISTANT_ID_NAMESPACE.replace(/-/g, ''), 'hex')
  const hash = createHash('sha1').update(ns).update(projectId).digest()
  const bytes = hash.subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50 // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC-4122 variant
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Create (or reuse) the project's dedicated assistant on the shared
 * `agent_builder` graph and return its `assistant_id`.
 *
 * Contract:
 *  - graph_id is always the shared `agent_builder` graph (one graph, many
 *    assistants) — the assistant is what distinguishes projects, not the graph.
 *  - `name` = the project name, so the assistant is human-recognisable in Studio.
 *  - `metadata` always carries `projectId` (the join back to the `projects` row),
 *    merged with any caller-supplied metadata (e.g. repoFullName). Caller keys
 *    do NOT override `projectId`.
 *  - the assistant id is DETERMINISTIC (v5 UUID from the projectId) and passed
 *    explicitly, so `ifExists: 'do_nothing'` collides on a retry (same projectId
 *    → same id) and the server returns the existing assistant instead of minting
 *    a duplicate. A metadata match alone would NOT dedupe — only a stable id does.
 *
 * Throws (never swallows) on transport/auth failure so the caller can fail the
 * project creation loudly rather than persist a half-wired project.
 */
export async function ensureProjectAssistant(args: {
  projectId: string
  name: string
  metadata?: Record<string, unknown>
}): Promise<string> {
  const c = agentServerClient()
  const assistant = await c.assistants.create({
    assistantId: assistantIdForProject(args.projectId),
    graphId: AGENT_BUILDER_GRAPH_ID,
    name: args.name,
    // projectId is the load-bearing join key — keep it last so a stray
    // `projectId` in caller metadata can never shadow the real one.
    metadata: { ...args.metadata, projectId: args.projectId },
    ifExists: 'do_nothing',
  })
  return assistant.assistant_id
}

/**
 * Best-effort delete of a project's assistant (used to roll back a project
 * creation that failed after the assistant was created, and by project
 * deletion). Never throws: a failed cleanup must not mask the original error —
 * a leftover assistant is inert (it only runs when a project row points a run at
 * it). Returns true on success, false if the delete failed.
 */
export async function deleteProjectAssistant(assistantId: string): Promise<boolean> {
  try {
    const c = agentServerClient()
    await c.assistants.delete(assistantId)
    return true
  } catch {
    return false
  }
}
