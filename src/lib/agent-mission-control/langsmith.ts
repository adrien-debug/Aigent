/**
 * Agent Mission Control — LangSmith trace client (server only).
 *
 * HONEST STATE: LangSmith is NOT wired. There is no `langsmith`/`langchain`
 * dependency and no LANGSMITH_* env in this project. So this module is a strict
 * no-op: it produces a real trace *id* (so internal steps can reference one) but
 * `getTraceUrl()` returns `null` unless a LangSmith deep-link base is actually
 * configured. It NEVER fabricates a langsmith.com URL — a null traceUrl is the
 * truth today, and the run-detail UI already renders "No trace recorded".
 *
 * To light this up later (no code change needed elsewhere), set env:
 *   LANGSMITH_API_KEY        — the LangSmith API key (enables real export; TODO)
 *   LANGCHAIN_TRACING_V2=true
 *   LANGSMITH_PROJECT        — project name the trace lands in
 *   LANGSMITH_TRACE_BASE_URL — deep-link base, e.g.
 *                              https://smith.langchain.com/o/<org>/projects/p/<project>/r
 * When LANGSMITH_TRACE_BASE_URL is present, getTraceUrl(traceId) returns
 * `${base}/${traceId}`. Until then it stays null. Wiring the real exporter
 * (POST runs to the LangSmith ingest API) is the remaining V2 step; the
 * abstraction below is where it plugs in.
 *
 * Never import from a client component (may read a secret key later).
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

/** Is a LangSmith deep-link base configured? (The only thing that yields a URL.) */
export function langsmithConfigured(): boolean {
  return Boolean(process.env.LANGSMITH_TRACE_BASE_URL)
}

/**
 * Mint a trace id for a run. Always returns a real id so internal steps can be
 * grouped under it; this id only becomes a clickable URL if a base is set.
 */
export function newTraceId(): string {
  return randomUUID()
}

/**
 * Deep-link for a trace id, or null when LangSmith isn't configured.
 * NEVER returns a fabricated URL — null is the honest value today.
 */
export function getTraceUrl(traceId: string | null): string | null {
  if (!traceId) return null
  const base = process.env.LANGSMITH_TRACE_BASE_URL
  if (!base) return null
  return `${base.replace(/\/$/, '')}/${traceId}`
}
