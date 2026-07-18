/**
 * Agent Mission Control — DB ↔ LangGraph assistant reconciliation (server only,
 * STRICTLY READ-ONLY).
 *
 * `reconcileAssistants()` is a pure diagnostic: it lists the assistants that
 * really exist on the LangGraph Agent Server (`listAssistants()`,
 * langgraph-explorer.ts) and cross-references them with the `assistant_id`
 * column the DB records on each copilot (and project), then classifies every
 * divergence into one of four classes. It NEVER creates, updates, deletes,
 * repairs, or provisions anything — it only reports. The repair path
 * (reprovision-assistants.ts) is a separate module that may CALL this one to log
 * the observed state before acting.
 *
 * The four classes (each row appears in the classes it qualifies for — a row can
 * be both `driftV5` and `stale`, they are independent facts):
 *
 *  - `stale`        — the DB row records an `assistant_id`, but that id is ABSENT
 *                     from the server. The DB points at an assistant that isn't
 *                     there (deleted server-side, or never actually created).
 *  - `orphan`       — a server assistant whose id is claimed by NO DB row. It
 *                     runs the shared `agent_builder` graph but nothing in the DB
 *                     dispatches to it. Assistants on OTHER graphs are ignored
 *                     (not ours to reconcile).
 *  - `driftV5`      — a copilot whose stored `assistant_id` differs from the
 *                     deterministic v5 id `assistantIdForCopilot(id)`. The DB was
 *                     wired to a non-canonical id (legacy / manual edit).
 *  - `inertPhantom` — a copilot whose `runtime` is NOT `langgraph` yet still
 *                     carries a non-null `assistant_id`. On the direct
 *                     model-router path this metadata is dead and misleading —
 *                     the assistant is never used, but its presence lies about
 *                     the runtime.
 *
 * Why read the raw PostgREST columns rather than the typed `Copilot`/`Project`:
 * `assistant_id` is a DB column that the read-model deliberately does NOT surface
 * (it is lifecycle plumbing, not product data), so there is no typed getter for
 * it. This module reads exactly the four columns it needs (id, assistant_id,
 * runtime, project_id) through the same PostgREST perimeter the data layer uses.
 *
 * Never import this module from a client component: `listAssistants()` uses the
 * authed Agent Server client and `pgrest` reads the service-role perimeter.
 */
import 'server-only'

import { AGENT_BUILDER_GRAPH_ID } from './langgraph-client'
import { assistantIdForCopilot } from './langgraph-assistants'
import { listAssistants, type ExplorerAssistant } from './langgraph-explorer'
import { pgrest } from './postgrest'
import type { AgentRuntime } from './types'

/** A DB copilot row, reduced to the columns reconciliation needs. */
export interface ReconcileCopilotRef {
  /** The copilot id. */
  copilotId: string
  /** Human-recognisable name (for the report), when present. */
  name: string | null
  /** The `assistant_id` the DB records for this copilot (null when unset). */
  assistantId: string | null
  /** The copilot's declared runtime. */
  runtime: AgentRuntime
  /** Owning project, or null for a bench copilot. */
  projectId: string | null
}

/** A DB project row that records its own fallback `assistant_id` (0008 path). */
export interface ReconcileProjectRef {
  projectId: string
  name: string | null
  assistantId: string | null
}

/**
 * A copilot whose DB `assistant_id` is not backed by a live server assistant.
 * `assistantId` is guaranteed non-null here (a null id records no claim at all).
 */
export interface StaleAssistant extends ReconcileCopilotRef {
  assistantId: string
}

/** A server assistant that no DB row claims. */
export interface OrphanAssistant {
  assistantId: string
  name: string | null
  graphId: string | null
}

/**
 * A copilot whose stored `assistant_id` drifted from the canonical v5 id.
 * `assistantId` is non-null; `expectedAssistantId` is `assistantIdForCopilot(id)`.
 */
export interface DriftV5Assistant extends ReconcileCopilotRef {
  assistantId: string
  expectedAssistantId: string
}

/**
 * A copilot on a non-langgraph runtime still carrying an `assistant_id`.
 * `assistantId` is non-null; `runtime` is guaranteed ≠ `'langgraph'`.
 */
export interface InertPhantomAssistant extends ReconcileCopilotRef {
  assistantId: string
}

/** The full reconciliation report — four independent divergence classes. */
export interface ReconcileReport {
  /** DB records an assistant_id that is absent from the server. */
  stale: StaleAssistant[]
  /** Server assistant (on our graph) claimed by no DB row. */
  orphan: OrphanAssistant[]
  /** Copilot assistant_id ≠ deterministic v5 id. */
  driftV5: DriftV5Assistant[]
  /** Non-langgraph copilot still carrying an assistant_id. */
  inertPhantom: InertPhantomAssistant[]
}

type RawRow = Record<string, unknown>

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** Read the copilot columns reconciliation needs, via the PostgREST perimeter. */
async function loadCopilotRefs(): Promise<ReconcileCopilotRef[]> {
  const rows = await pgrest<RawRow[]>('GET', 'copilots?select=id,name,assistant_id,runtime,project_id&order=name')
  return rows.map((r) => ({
    copilotId: String(r.id ?? ''),
    name: str(r.name),
    assistantId: str(r.assistant_id),
    runtime: (str(r.runtime) ?? 'custom') as AgentRuntime,
    projectId: str(r.project_id),
  }))
}

/** Read the project fallback-assistant columns, via the PostgREST perimeter. */
async function loadProjectRefs(): Promise<ReconcileProjectRef[]> {
  const rows = await pgrest<RawRow[]>('GET', 'projects?select=id,name,assistant_id&order=name')
  return rows.map((r) => ({
    projectId: String(r.id ?? ''),
    name: str(r.name),
    assistantId: str(r.assistant_id),
  }))
}

/**
 * Reconcile the DB's recorded assistant ids against the LangGraph server's live
 * assistants and classify every divergence. Pure read-only: three reads (the
 * server's assistants, the copilots, the projects), zero writes. All reads run
 * in parallel — they are independent.
 *
 * A given copilot can appear in more than one class (e.g. a non-langgraph
 * copilot whose id also drifted is in BOTH `inertPhantom` and `driftV5`); the
 * classes are independent facts, not a partition.
 */
export async function reconcileAssistants(): Promise<ReconcileReport> {
  const [serverAssistants, copilots, projects] = await Promise.all([
    listAssistants(),
    loadCopilotRefs(),
    loadProjectRefs(),
  ])

  // Set of assistant ids that actually exist on the server (for `stale`).
  const serverIds = new Set<string>(serverAssistants.map((a) => a.assistantId).filter((id) => id.length > 0))

  // Set of assistant ids the DB claims (copilots + projects), for `orphan`.
  const claimedIds = new Set<string>()
  for (const c of copilots) if (c.assistantId) claimedIds.add(c.assistantId)
  for (const p of projects) if (p.assistantId) claimedIds.add(p.assistantId)

  const stale: StaleAssistant[] = []
  const driftV5: DriftV5Assistant[] = []
  const inertPhantom: InertPhantomAssistant[] = []

  for (const c of copilots) {
    if (c.assistantId === null) continue
    const assistantId = c.assistantId

    // stale — DB claims an id the server doesn't have.
    if (!serverIds.has(assistantId)) {
      stale.push({ ...c, assistantId })
    }

    // driftV5 — stored id ≠ the deterministic v5 id for this copilot.
    const expected = assistantIdForCopilot(c.copilotId)
    if (assistantId !== expected) {
      driftV5.push({ ...c, assistantId, expectedAssistantId: expected })
    }

    // inertPhantom — non-langgraph runtime still carrying an assistant_id.
    if (c.runtime !== 'langgraph') {
      inertPhantom.push({ ...c, assistantId })
    }
  }

  // orphan — a server assistant on OUR graph that no DB row claims. Assistants
  // on other graphs are not ours to reconcile and are skipped.
  const orphan: OrphanAssistant[] = serverAssistants
    .filter((a: ExplorerAssistant) => a.assistantId.length > 0)
    .filter((a) => (a.graphId ?? AGENT_BUILDER_GRAPH_ID) === AGENT_BUILDER_GRAPH_ID)
    .filter((a) => !claimedIds.has(a.assistantId))
    .map((a) => ({ assistantId: a.assistantId, name: a.name ?? null, graphId: a.graphId ?? null }))

  return { stale, orphan, driftV5, inertPhantom }
}
