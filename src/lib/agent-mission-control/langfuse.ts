/**
 * Agent Mission Control — Langfuse trace client (server only).
 *
 * Second exporter, alongside ./langsmith. Same doctrine, on purpose:
 *   - zero dependency (native fetch, no `langfuse` npm package),
 *   - strict no-op when unconfigured (no call, no fabricated URL),
 *   - fail-soft: an export failure NEVER fails a run — errors are swallowed
 *     into `{ exported: false, reason }`.
 *
 * Target is Adrien's SELF-HOSTED Langfuse (langfuse/langfuse:2), whose public
 * ingestion API is a single batch endpoint: POST `${host}/api/public/ingestion`
 * with Basic auth (public key as user, secret key as password) and a body of
 * `{ batch: [event, ...] }`. Each event is `{ id, type, timestamp, body }`.
 *
 * Mapping Aigent → Langfuse:
 *   - one `trace-create` per run (name = copilot, metadata = copilotId/versionId/runtime),
 *   - one `generation-create` per LLM step (model, provider, input/output, usage, cost),
 *   - one `span-create` per tool call (name, status, `blocked` surfaced in level+statusMessage).
 *
 * Env (never rendered to the browser):
 *   LANGFUSE_HOST        — base URL, e.g. http://192.168.1.74:3001. Absent → no-op.
 *   LANGFUSE_PUBLIC_KEY  — Basic auth user.   Absent → no-op.
 *   LANGFUSE_SECRET_KEY  — Basic auth password. Absent → no-op.
 *
 * Never import from a client component (reads a secret key).
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

/** A single step as handed over by the run trace layer. */
export interface LangfuseTraceStep {
  name: string
  /** Rich trace kind ('llm-call' | 'tool-call' | 'judge' | 'fallback' | …). */
  kind: string
  status: 'ok' | 'warning' | 'blocked' | 'error' | string
  detail: string
  startedAt: string
  durationMs: number
  model?: string
  provider?: string
  input?: unknown
  output?: unknown
  usage?: LangfuseUsage
  costUsd?: number
}

export interface LangfuseUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export interface LangfuseTracePayload {
  traceId: string
  /** Trace name — the copilot, per the mapping contract. */
  name: string
  userId?: string | null
  sessionId?: string | null
  input?: unknown
  output?: unknown
  metadata: Record<string, unknown>
  tags?: string[]
  steps: LangfuseTraceStep[]
  startedAt: string
  finishedAt: string
}

export interface LangfuseExportResult {
  exported: boolean
  /** Number of events actually POSTed (0 when no-op or failed). */
  eventCount: number
  traceUrl: string | null
  reason?: string
}

interface LangfuseConfig {
  host: string
  publicKey: string
  secretKey: string
}

/** Resolved config, or null when any of the three vars is missing/blank. */
function readConfig(): LangfuseConfig | null {
  const host = process.env.LANGFUSE_HOST?.trim()
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim()
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim()
  if (!host || !publicKey || !secretKey) return null
  return { host: host.replace(/\/$/, ''), publicKey, secretKey }
}

/** True when all three Langfuse vars are set — i.e. export will actually POST. */
export function isLangfuseConfigured(): boolean {
  return readConfig() !== null
}

/**
 * Deep-link to a trace in the self-hosted UI, or null when unconfigured.
 * NEVER fabricates a URL: no host, no link.
 */
export function getLangfuseTraceUrl(traceId: string | null): string | null {
  if (!traceId) return null
  const config = readConfig()
  if (!config) return null
  return traceUrlFor(config, traceId)
}

/** The one place the trace-URL shape is written. */
function traceUrlFor(config: LangfuseConfig, traceId: string): string {
  return `${config.host}/trace/${traceId}`
}

/** Langfuse observation levels. `blocked`/`error` must be visible as such. */
type LangfuseLevel = 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR'

function toLevel(status: string): LangfuseLevel {
  switch (status) {
    case 'error':
      return 'ERROR'
    case 'blocked':
      return 'ERROR'
    case 'warning':
      return 'WARNING'
    default:
      return 'DEFAULT'
  }
}

/**
 * End timestamp of a step, from its start + duration.
 *
 * Defensive on purpose: a step whose `durationMs` is absent or non-finite must
 * degrade to "ends when it starts" rather than produce an Invalid Date, which
 * would throw out of `buildLangfuseBatch` and break the caller's run. Export is
 * observability — it never gets to fail a run.
 */
function endTime(startedAt: string, durationMs: number): string {
  const start = Date.parse(startedAt)
  if (Number.isNaN(start)) return startedAt
  const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
  return new Date(start + duration).toISOString()
}

/** A step is a `generation` when it represents a model call, else a `span`. */
function isGeneration(kind: string): boolean {
  return kind === 'llm-call' || kind === 'judge'
}

function toUsagePayload(usage: LangfuseUsage | undefined): Record<string, unknown> | undefined {
  if (!usage) return undefined
  const out: Record<string, unknown> = {}
  if (typeof usage.promptTokens === 'number') out.promptTokens = usage.promptTokens
  if (typeof usage.completionTokens === 'number') out.completionTokens = usage.completionTokens
  if (typeof usage.totalTokens === 'number') out.totalTokens = usage.totalTokens
  return Object.keys(out).length > 0 ? out : undefined
}

interface LangfuseEvent {
  id: string
  type: string
  timestamp: string
  body: Record<string, unknown>
}

/**
 * Build the ingestion batch for a payload. Exported for tests so the wire shape
 * can be asserted without a network call.
 */
export function buildLangfuseBatch(payload: LangfuseTracePayload): LangfuseEvent[] {
  const events: LangfuseEvent[] = [
    {
      id: randomUUID(),
      type: 'trace-create',
      timestamp: payload.finishedAt,
      body: {
        id: payload.traceId,
        name: payload.name,
        timestamp: payload.startedAt,
        userId: payload.userId ?? undefined,
        sessionId: payload.sessionId ?? undefined,
        input: payload.input,
        output: payload.output,
        metadata: payload.metadata,
        tags: payload.tags,
      },
    },
  ]

  payload.steps.forEach((step, index) => {
    const generation = isGeneration(step.kind)
    const observationId = `${payload.traceId}-${index}`
    const body: Record<string, unknown> = {
      id: observationId,
      traceId: payload.traceId,
      name: step.name,
      startTime: step.startedAt,
      endTime: endTime(step.startedAt, step.durationMs),
      level: toLevel(step.status),
      statusMessage: step.detail,
      metadata: {
        kind: step.kind,
        status: step.status,
        durationMs: step.durationMs,
        ...(step.status === 'blocked' ? { blocked: true } : {}),
      },
    }
    if (step.input !== undefined) body.input = step.input
    if (step.output !== undefined) body.output = step.output

    if (generation) {
      if (step.model) body.model = step.model
      if (step.provider) {
        body.metadata = { ...(body.metadata as Record<string, unknown>), provider: step.provider }
      }
      const usage = toUsagePayload(step.usage)
      if (usage) body.usage = usage
      if (typeof step.costUsd === 'number') body.calculatedTotalCost = step.costUsd
    }

    events.push({
      id: randomUUID(),
      type: generation ? 'generation-create' : 'span-create',
      timestamp: step.startedAt,
      body,
    })
  })

  return events
}

/**
 * Export a finished trace to the self-hosted Langfuse.
 *
 * Unconfigured → strict no-op ({exported:false, eventCount:0, traceUrl:null}),
 * no fetch is issued. Configured → one batch POST. Any network/HTTP failure is
 * swallowed into {exported:false, reason} so a run never fails on tracing.
 */
export async function exportLangfuseTrace(
  payload: LangfuseTracePayload
): Promise<LangfuseExportResult> {
  const config = readConfig()
  if (!config) {
    return {
      exported: false,
      eventCount: 0,
      traceUrl: null,
      reason: 'LANGFUSE_HOST/PUBLIC_KEY/SECRET_KEY not set',
    }
  }

  const traceUrl = traceUrlFor(config, payload.traceId)
  // Built inside the guarded section: a malformed step must degrade to a
  // skipped export, never throw into the run that produced it.
  let batch: LangfuseEvent[]
  try {
    batch = buildLangfuseBatch(payload)
  } catch (err) {
    return {
      exported: false,
      eventCount: 0,
      traceUrl,
      reason: err instanceof Error ? `batch build failed: ${err.message}` : 'batch build failed',
    }
  }
  const auth = Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64')

  try {
    const res = await fetch(`${config.host}/api/public/ingestion`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ batch }),
      cache: 'no-store',
    })
    if (!res.ok) {
      return { exported: false, eventCount: 0, traceUrl, reason: `Langfuse ${res.status}` }
    }
    // Langfuse answers 207 with PER-EVENT outcomes: a rejected event is
    // reported in `errors` while the HTTP status stays 2xx. Trusting res.ok
    // alone reports a silent drop as a success — the exact failure this
    // exporter must never hide.
    const body = (await res.json().catch(() => null)) as {
      successes?: Array<{ id: string }>
      errors?: Array<{ id?: string; status?: number; message?: string; error?: unknown }>
    } | null
    const errors = body?.errors ?? []
    if (errors.length > 0) {
      const first = errors[0]
      const detail = first?.message ?? (first?.error ? JSON.stringify(first.error) : 'unspecified')
      return {
        exported: false,
        eventCount: body?.successes?.length ?? 0,
        traceUrl,
        reason: `Langfuse rejected ${errors.length}/${batch.length} event(s): ${String(detail).slice(0, 300)}`,
      }
    }
    return { exported: true, eventCount: body?.successes?.length ?? batch.length, traceUrl }
  } catch (err) {
    return {
      exported: false,
      eventCount: 0,
      traceUrl,
      reason: err instanceof Error ? err.message : 'network error',
    }
  }
}
