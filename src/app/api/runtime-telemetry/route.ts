import { NextResponse } from 'next/server'
import { z } from 'zod'

import { extractBearerToken, timingSafeEqual } from '@/lib/agent-mission-control/bearer-token-auth'
import { isPgrestTimeout, pgrest } from '@/lib/agent-mission-control/postgrest'
import { normalizeTelemetryProviderToModelProvider } from '@/lib/agent-mission-control/runtime-telemetry-store'

/**
 * POST /api/runtime-telemetry — ingestion endpoint for the runtime telemetry
 * events emitted by generated Aigent agent handlers running in a CONSUMER
 * repo (opt-in, best-effort on their side — see github.ts SHARED_TYPES).
 *
 * Deliberately mounted OUTSIDE /api/agent-ops/**: that prefix is guarded by
 * the proxy session/AMC_API_KEY gate (src/proxy.ts) meant for the AMC admin
 * surface. This route is a separate, narrower trust boundary — a consumer
 * repo's deployed agent, not an AMC operator — so it authenticates itself
 * here with its OWN dedicated bearer token (AIGENT_RUNTIME_TELEMETRY_TOKEN),
 * never AMC_API_KEY/AMC_ADMIN_PASSWORD.
 *
 * Fail-closed on config, generic on every rejection, and the payload is
 * treated as attacker-controlled end to end: size-capped, shape-validated,
 * scanned for obvious secret patterns, and never echoed back — including on
 * error (no `err.message`, no stack trace, ever reaches the response).
 */

// --- Auth (shared bearer-token util) ---------------------------------------
// extractBearerToken + timingSafeEqual live in bearer-token-auth.ts, shared
// with the runtime registry API — one source, no drift.

// --- Payload limits ----------------------------------------------------

const MAX_PAYLOAD_BYTES = 16 * 1024 // 16KB
const MAX_FIELD_LENGTH = 500

// --- Shape (mirrors migration 0017 runtime_telemetry_events columns) ------

// Wire vocabulary reported by a deployed handler. This stays the vocabulary
// VALIDATED here; it is NOT what gets persisted. The row stores the provider
// already normalized onto the internal ModelProvider union (see
// persistedProvider below) so the table holds exactly one spelling per
// provider and reads never have to re-translate.
const providerEnum = z.enum(['openai', 'gemini', 'custom', 'unknown'])
const statusEnum = z.enum(['started', 'completed', 'failed'])
const errorCategoryEnum = z.enum(['provider_error', 'timeout', 'validation', 'tool_error', 'unknown'])
const nodeEnvEnum = z.enum(['production', 'development', 'test', 'unknown'])
const runtimeEnum = z.enum(['node', 'edge', 'unknown'])

const boundedString = (max = MAX_FIELD_LENGTH) => z.string().trim().min(1).max(max)

const inputShapeSchema = z
  .object({
    hasMessages: z.boolean().optional(),
    messageCount: z.number().int().min(0).max(1_000_000).optional(),
    hasTools: z.boolean().optional(),
    toolCount: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict()

const outputShapeSchema = z
  .object({
    hasText: z.boolean().optional(),
    textLength: z.number().int().min(0).max(100_000_000).optional(),
    hasToolCalls: z.boolean().optional(),
    toolCallCount: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict()

const errorSchema = z
  .object({
    name: boundedString().optional(),
    code: boundedString().optional(),
    messageHash: boundedString().optional(),
    category: errorCategoryEnum.optional(),
  })
  .strict()

const usageSchema = z
  .object({
    inputTokens: z.number().int().min(0).max(100_000_000).optional(),
    outputTokens: z.number().int().min(0).max(100_000_000).optional(),
    totalTokens: z.number().int().min(0).max(100_000_000).optional(),
  })
  .strict()

const environmentSchema = z
  .object({
    nodeEnv: nodeEnvEnum.optional(),
    runtime: runtimeEnum.optional(),
  })
  .strict()

const runtimeTelemetryEventSchema = z
  .object({
    eventId: boundedString(),
    projectId: boundedString(),
    agentId: boundedString(),
    agentVersion: boundedString().optional(),
    targetRepo: boundedString().optional(),
    runId: boundedString(),
    timestamp: boundedString(),
    provider: providerEnum.optional(),
    model: boundedString().optional(),
    status: statusEnum,
    latencyMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
    inputShape: inputShapeSchema.optional(),
    outputShape: outputShapeSchema.optional(),
    error: errorSchema.optional(),
    usage: usageSchema.optional(),
    environment: environmentSchema.optional(),
  })
  .strict()

type RuntimeTelemetryEvent = z.infer<typeof runtimeTelemetryEventSchema>

// --- Secret scan -------------------------------------------------------
//
// Best-effort defense-in-depth: the generated handler is contractually
// forbidden from sending raw secrets (redactInputs/redactOutputs default
// true), but this endpoint doesn't trust the client — it re-scans every
// string in the payload for the obvious high-signal patterns before insert.

const SECRET_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9_-]{8,}/, // generic API secret key prefix (Anthropic/OpenAI-style)
  /ghp_[a-zA-Z0-9]{8,}/, // GitHub personal access token
  /eyJ[a-zA-Z0-9_-]{8,}/, // JWT / base64url signature header
  /-----BEGIN/, // PEM-encoded key/cert block
  /Authorization:\s*Bearer/i, // raw header dump
  /Bearer\s+[a-zA-Z0-9_.-]{16,}/, // bearer token value
]

function containsSuspiciousContent(value: unknown, depth = 0): boolean {
  // Depth cap: the schema above is already `.strict()` with a shallow known
  // shape, so legitimate payloads never nest this deep — this only guards
  // against a pathological input before it reaches the regex scan.
  if (depth > 10) return true
  if (typeof value === 'string') {
    return SECRET_PATTERNS.some((re) => re.test(value))
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsSuspiciousContent(item, depth + 1))
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) => containsSuspiciousContent(v, depth + 1))
  }
  return false
}

// --- Provider normalization (ingestion boundary) ---------------------------

/**
 * The value actually written to `runtime_telemetry_events.provider`.
 *
 * Normalizing HERE — once per event, at the only write path — rather than on
 * every read is what keeps the column a single, reliable vocabulary: the day a
 * handler starts emitting `vertex`/`google` for what another calls `gemini`,
 * the table would otherwise hold three spellings of one provider and the
 * historical truth would be unrecoverable without guessing.
 *
 * `custom`/`unknown` (and a missing provider) are NEVER guessed at: they have
 * no knowable backing provider, so they are stored verbatim (resp. null) and
 * will simply not be priced downstream. Storing a fabricated provider — or
 * letting a fabricated one produce a cost of `0` — would be a lie; doctrine is
 * that unavailable data is `null`, never `0`.
 */
function persistedProvider(provider: RuntimeTelemetryEvent['provider']): string | null {
  if (!provider) return null
  const normalized = normalizeTelemetryProviderToModelProvider(provider)
  return normalized ?? provider
}

// --- Route -----------------------------------------------------------------

export async function POST(request: Request) {
  const expectedToken = process.env.AIGENT_RUNTIME_TELEMETRY_TOKEN
  if (!expectedToken) {
    // Config missing, not a client error — never leak *why* beyond that fact.
    return NextResponse.json({ error: 'runtime telemetry ingestion is not configured' }, { status: 503 })
  }

  const providedToken = extractBearerToken(request, 'x-aigent-telemetry-token')
  if (!providedToken || !timingSafeEqual(providedToken, expectedToken)) {
    // Generic 401 — never echo the provided token, never log it either.
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: 'payload too large' }, { status: 413 })
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const result = runtimeTelemetryEventSchema.safeParse(parsedJson)
  if (!result.success) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 })
  }
  const event: RuntimeTelemetryEvent = result.data

  if (containsSuspiciousContent(event)) {
    // Deliberately vague — never reveal which field/pattern tripped it.
    return NextResponse.json({ error: 'payload rejected: suspicious content' }, { status: 400 })
  }

  try {
    await pgrest('POST', 'runtime_telemetry_events', {
      id: event.eventId,
      project_id: event.projectId,
      agent_id: event.agentId,
      agent_version: event.agentVersion ?? null,
      target_repo: event.targetRepo ?? null,
      run_id: event.runId,
      received_at: event.timestamp,
      provider: persistedProvider(event.provider),
      model: event.model ?? null,
      status: event.status,
      latency_ms: event.latencyMs ?? null,
      input_shape: event.inputShape ?? {},
      output_shape: event.outputShape ?? {},
      error: event.error ?? {},
      usage: event.usage ?? {},
      environment: event.environment ?? {},
    })
  } catch (err) {
    // Idempotent re-delivery: eventId is the PK, so a duplicate event (a client
    // retrying a telemetry POST whose 202 was lost) collides 23505/409. That is
    // success from the caller's view — the event already landed — so ACK 202
    // rather than 500, otherwise best-effort clients retry-storm on a row that
    // is already there.
    const status = (err as { status?: number })?.status
    if (status === 409 || /23505|duplicate key/i.test(String((err as Error)?.message))) {
      return NextResponse.json({ ok: true, deduplicated: true }, { status: 202 })
    }
    // Never forward err.message or a stack trace to the client — log
    // server-side only, respond with a generic status.
    console.error('[runtime-telemetry] insert failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'internal error' }, { status: isPgrestTimeout(err) ? 504 : 500 })
  }

  return NextResponse.json({ ok: true }, { status: 202 })
}
