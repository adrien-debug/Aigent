/**
 * Agent Mission Control — run-assistant resolution (server only).
 *
 * SINGLE source for "which LangGraph assistant does this run target?", used by
 * the three run paths (runner.ts, test-runner.ts, and the resume route) so the
 * cascade lives in exactly ONE place — never re-implemented.
 *
 * Cascade (most specific wins):
 *   1. copilots.assistant_id — the copilot's OWN assistant, whose
 *      config.configurable carries its full behaviour (0009). This is the
 *      primary target now.
 *   2. projects.assistant_id — the project's assistant (0008), a fallback for a
 *      legacy copilot whose assistant hasn't been provisioned yet.
 *   3. undefined — no dedicated assistant at all → the caller falls back to the
 *      shared `agent_builder` graph id inside runOnAgentServer (old behaviour).
 *
 * Every lookup is a single PostgREST select on the same perimeter the callers
 * already use. Non-throwing at the field level (a null column just steps down
 * the cascade); a transport error propagates to the caller as usual.
 *
 * Never import from a client component: it reads the service-role perimeter.
 */
import 'server-only'

import { pgrest } from './postgrest'

type RawRow = Record<string, unknown>

/** Non-empty string field, else undefined. */
function nonEmpty(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/**
 * Resolve a copilot's run assistant id via the cascade above. Loads only what it
 * needs: the copilot's assistant_id + project_id in one select, then the
 * project's assistant_id only if the copilot has none. Returns undefined when
 * nothing is wired (→ shared graph id fallback in runOnAgentServer).
 */
export async function resolveRunAssistantId(copilotId: string): Promise<string | undefined> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `copilots?id=eq.${encodeURIComponent(copilotId)}&select=assistant_id,project_id`
  )
  const row = rows[0]
  if (!row) return undefined

  const copilotAssistant = nonEmpty(row.assistant_id)
  if (copilotAssistant) return copilotAssistant

  const projectId = nonEmpty(row.project_id)
  if (!projectId) return undefined

  return resolveProjectAssistantId(projectId)
}

/**
 * Resolve JUST the project's assistant id (cascade step 2). Exposed for callers
 * that already hold the copilot row (e.g. test-runner reads project_id from it)
 * so they can skip the extra copilots select — the cascade order is preserved by
 * the caller trying the copilot's own assistant_id first.
 */
export async function resolveProjectAssistantId(projectId: string): Promise<string | undefined> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `projects?id=eq.${encodeURIComponent(projectId)}&select=assistant_id`
  )
  return nonEmpty(rows[0]?.assistant_id)
}

/**
 * Resolve the run assistant from an ALREADY-LOADED copilot row (the row must
 * carry `assistant_id` and `project_id`). Same cascade, but avoids re-selecting
 * the copilot when the caller has it in hand (runner/test-runner). Only the
 * project lookup (step 2) touches the DB, and only when the copilot has no
 * assistant of its own.
 */
export async function resolveRunAssistantFromRow(row: {
  assistant_id?: unknown
  project_id?: unknown
}): Promise<string | undefined> {
  const copilotAssistant = nonEmpty(row.assistant_id)
  if (copilotAssistant) return copilotAssistant

  const projectId = nonEmpty(row.project_id)
  if (!projectId) return undefined

  return resolveProjectAssistantId(projectId)
}
