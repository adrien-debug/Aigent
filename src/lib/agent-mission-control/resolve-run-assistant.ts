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
 * LIVENESS CHECK (the actual fix for the silent-hallucination bug): the
 * `langgraphjs dev` Agent Server keeps assistants IN MEMORY. A server restart
 * wipes every provisioned assistant while the DB still holds its `assistant_id`
 * column. Before this module hands an id back to a caller, it verifies the
 * assistant still exists on the Agent Server (`client.assistants.get`). If it's
 * gone, it re-provisions it on the spot (ensureCopilotAssistant /
 * ensureProjectAssistant are idempotent: deterministic v5 id + do_nothing +
 * unconditional config update), so the SAME id comes back with the RIGHT
 * config.configurable. A run must never silently fall through to the bare
 * `agent_builder` graph just because the in-memory assistant vanished — that
 * bare-graph path has no repo tools wired and the model hallucinates the repo
 * while the run still reports `completed`. If re-provisioning itself fails, the
 * error propagates (fail loud) instead of returning undefined.
 *
 * Never import from a client component: it reads the service-role perimeter.
 */
import 'server-only'

import { agentServerClient } from './langgraph-client'
import { ensureCopilotAssistant, ensureProjectAssistant } from './langgraph-assistants'
import { pgrest } from './postgrest'

type RawRow = Record<string, unknown>

/** Non-empty string field, else undefined. */
function nonEmpty(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** True when an error thrown by the LangGraph SDK is an HTTP 404 (assistant not found). */
function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'status' in err && (err as { status?: unknown }).status === 404
}

/**
 * Verify a copilot's OWN assistant still exists on the Agent Server; if it
 * vanished (in-memory store wiped by a server restart), re-provision it at the
 * SAME deterministic id via ensureCopilotAssistant so the config is fresh too.
 * Any non-404 transport error propagates (fail loud, no silent bare-graph
 * fallback for a run that actually has a copilot to provision for).
 */
async function ensureCopilotAssistantIsLive(copilotId: string, assistantId: string): Promise<string> {
  const c = agentServerClient()
  try {
    await c.assistants.get(assistantId)
    return assistantId
  } catch (err) {
    if (!isNotFound(err)) throw err
    return ensureCopilotAssistant({ copilotId })
  }
}

/**
 * Verify a project's assistant still exists on the Agent Server; if it
 * vanished, re-provision it via ensureProjectAssistant. Needs the project's
 * name for the (re-)create call, so it loads the project row itself — this
 * path is only hit on the legacy fallback (copilot has no assistant of its
 * own), never on the hot path.
 */
async function ensureProjectAssistantIsLive(projectId: string, assistantId: string): Promise<string> {
  const c = agentServerClient()
  try {
    await c.assistants.get(assistantId)
    return assistantId
  } catch (err) {
    if (!isNotFound(err)) throw err
    const rows = await pgrest<RawRow[]>(
      'GET',
      `projects?id=eq.${encodeURIComponent(projectId)}&select=name`
    )
    const name = nonEmpty(rows[0]?.name) ?? projectId
    return ensureProjectAssistant({ projectId, name })
  }
}

/**
 * Resolve a copilot's run assistant id via the cascade above. Loads only what it
 * needs: the copilot's assistant_id + project_id in one select, then the
 * project's assistant_id only if the copilot has none. Returns undefined when
 * nothing is wired (→ shared graph id fallback in runOnAgentServer). Whichever
 * id the cascade lands on is verified LIVE (and re-provisioned if missing)
 * before being returned — see the module header.
 */
export async function resolveRunAssistantId(copilotId: string): Promise<string | undefined> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `copilots?id=eq.${encodeURIComponent(copilotId)}&select=assistant_id,project_id`
  )
  const row = rows[0]
  if (!row) return undefined

  const copilotAssistant = nonEmpty(row.assistant_id)
  if (copilotAssistant) return ensureCopilotAssistantIsLive(copilotId, copilotAssistant)

  const projectId = nonEmpty(row.project_id)
  if (!projectId) return undefined

  return resolveProjectAssistantId(projectId)
}

/**
 * Resolve JUST the project's assistant id (cascade step 2). Exposed for callers
 * that already hold the copilot row (e.g. test-runner reads project_id from it)
 * so they can skip the extra copilots select — the cascade order is preserved by
 * the caller trying the copilot's own assistant_id first. The returned id is
 * verified live (and re-provisioned if missing) before being returned.
 */
export async function resolveProjectAssistantId(projectId: string): Promise<string | undefined> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `projects?id=eq.${encodeURIComponent(projectId)}&select=assistant_id`
  )
  const assistantId = nonEmpty(rows[0]?.assistant_id)
  if (!assistantId) return undefined
  return ensureProjectAssistantIsLive(projectId, assistantId)
}

/**
 * Resolve the run assistant from an ALREADY-LOADED copilot row (the row must
 * carry `assistant_id` and `project_id`). Same cascade, but avoids re-selecting
 * the copilot when the caller has it in hand (runner/test-runner). Only the
 * project lookup (step 2) touches the DB, and only when the copilot has no
 * assistant of its own. The returned id is verified live (and re-provisioned if
 * missing) before being returned.
 */
export async function resolveRunAssistantFromRow(row: {
  id?: unknown
  assistant_id?: unknown
  project_id?: unknown
}): Promise<string | undefined> {
  const copilotAssistant = nonEmpty(row.assistant_id)
  if (copilotAssistant) {
    const copilotId = nonEmpty(row.id)
    // `id` must always be present alongside `assistant_id` — it is what proves
    // the assistant is still LIVE on the Agent Server (see module header). A
    // caller whose select omits `id` is a programming error: skipping the
    // liveness check here would silently reopen the exact hallucination bug
    // this module exists to close (bare-graph fallback, run still reports
    // `completed`). Fail loud instead.
    if (!copilotId) {
      throw new Error(
        'resolveRunAssistantFromRow: row.id is required to verify the assistant is live — the caller must select it'
      )
    }
    return ensureCopilotAssistantIsLive(copilotId, copilotAssistant)
  }

  const projectId = nonEmpty(row.project_id)
  if (!projectId) return undefined

  return resolveProjectAssistantId(projectId)
}
