/**
 * Agent Mission Control — LangSmith trace client (server only).
 *
 * HONEST STATE: this project ships NO `langsmith`/`langchain` dependency and NO
 * LANGSMITH_* env. So at runtime here this module is a strict no-op:
 * `exportTrace()` returns `{ exported: false, traceUrl: null }` and never calls
 * out. It NEVER fabricates a smith.langchain.com URL.
 *
 * A REAL exporter IS implemented (dependency-free fetch against the documented
 * LangSmith ingest API) and activates ONLY when `LANGSMITH_API_KEY` is present.
 * It has NOT been executed against LangSmith in this environment (no key), so
 * treat the export path as wired-but-unverified until it runs with a real key.
 *
 * Env (nothing here is ever rendered to the browser):
 *   LANGSMITH_API_KEY        — enables the real export POST. Absent → no-op.
 *   LANGSMITH_ENDPOINT       — API base, default https://api.smith.langchain.com
 *   LANGSMITH_PROJECT        — project (session) name runs land in; default "agent-mission-control"
 *   LANGSMITH_TRACE_BASE_URL — deep-link base, e.g.
 *                              https://smith.langchain.com/o/<org>/projects/p/<project>/r
 *                              Only this yields a clickable traceUrl; without it,
 *                              a run may still be exported but traceUrl stays null.
 *
 * Never import from a client component (reads a secret key).
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

const DEFAULT_ENDPOINT = 'https://api.smith.langchain.com'
const DEFAULT_PROJECT = 'agent-mission-control'

/** Mint a trace id. Always real so steps group under it; URL is separate. */
export function newTraceId(): string {
  return randomUUID()
}

/**
 * Deep-link for a trace id, or null when no deep-link base is configured.
 * NEVER returns a fabricated URL. A run can be exported (POSTed) yet still have
 * a null traceUrl if LANGSMITH_TRACE_BASE_URL isn't set — that's honest.
 */
export function getTraceUrl(traceId: string | null): string | null {
  if (!traceId) return null
  const base = process.env.LANGSMITH_TRACE_BASE_URL
  if (!base) return null
  return `${base.replace(/\/$/, '')}/${traceId}`
}

export interface LangSmithTraceStep {
  name: string
  kind: string
  status: string
  detail: string
  startedAt: string
  durationMs: number
}

export interface LangSmithTracePayload {
  traceId: string
  name: string
  runType: 'chain' | 'llm' | 'tool'
  inputs: Record<string, unknown>
  outputs?: Record<string, unknown>
  metadata: Record<string, unknown>
  steps: LangSmithTraceStep[]
  startedAt: string
  finishedAt: string
}

export interface LangSmithExportResult {
  traceUrl: string | null
  exported: boolean
  reason?: string
}

/**
 * Export a finished trace to LangSmith.
 *
 * Fail-open for the RUN (never throws): a run must not fail because tracing is
 * down. If `LANGSMITH_API_KEY` is absent → strict no-op ({exported:false}). If
 * present → a single dependency-free POST to `${endpoint}/runs` shaped per the
 * LangSmith ingest API (id, name, run_type, inputs, outputs, extra.metadata,
 * session_name, start/end time). Network/HTTP failures are swallowed into
 * {exported:false, reason} — the run still persists, traceUrl still resolves via
 * getTraceUrl (null unless a deep-link base is set).
 *
 * NOTE: not executed against LangSmith in this environment (no key). The shape
 * follows the documented ingest contract but is unverified live here.
 */
export async function exportTrace(payload: LangSmithTracePayload): Promise<LangSmithExportResult> {
  const apiKey = process.env.LANGSMITH_API_KEY
  const traceUrl = getTraceUrl(payload.traceId)

  if (!apiKey) {
    // Strict no-op — no key, no call, no fabricated URL.
    return { traceUrl, exported: false, reason: 'LANGSMITH_API_KEY not set' }
  }

  const endpoint = (process.env.LANGSMITH_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/$/, '')
  const project = process.env.LANGSMITH_PROJECT || DEFAULT_PROJECT

  try {
    const res = await fetch(`${endpoint}/runs`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: payload.traceId,
        name: payload.name,
        run_type: payload.runType,
        inputs: payload.inputs,
        outputs: payload.outputs ?? {},
        extra: { metadata: payload.metadata },
        session_name: project,
        start_time: payload.startedAt,
        end_time: payload.finishedAt,
        // Nested children as serialized events (LangSmith accepts child runs
        // separately; we attach a compact step log in metadata for a first pass).
        events: payload.steps.map((s) => ({
          name: s.name,
          kind: s.kind,
          status: s.status,
          time: s.startedAt,
          duration_ms: s.durationMs,
          message: s.detail,
        })),
      }),
    })
    if (!res.ok) {
      return { traceUrl, exported: false, reason: `LangSmith ${res.status}` }
    }
    return { traceUrl, exported: true }
  } catch (err) {
    return { traceUrl, exported: false, reason: err instanceof Error ? err.message : 'network error' }
  }
}
