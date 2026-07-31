import { NextResponse } from 'next/server'
import { z } from 'zod'

import { extractBearerToken } from '@/lib/agent-mission-control/bearer-token-auth'
import { CONSUMER_EVENT_TYPES } from '@/lib/agent-mission-control/consumer-activation'
import {
  authenticateInstallation,
  touchInstallationSeen,
} from '@/lib/agent-mission-control/consumer-installations'
import { isPgrestTimeout, pgrest } from '@/lib/agent-mission-control/postgrest'

/**
 * POST /api/runtime-telemetry/consumer — the consumer feedback channel.
 *
 * This is the route that closes the loop AGENTS.md draws:
 *   create → qualify → ship → [consumer executes] → telemetry → improve
 * Before it existed, every telemetry row in the database came from an Aigent
 * emitter. Nothing in the repository could produce an event of consumer
 * provenance, so `active_in_consumer` was structurally unknowable.
 *
 * ── Why a fourth identity, not the shared telemetry token ───────────────────
 * The sibling route (/api/runtime-telemetry) authenticates every caller with
 * ONE shared value, AIGENT_RUNTIME_TELEMETRY_TOKEN. That is sufficient to gate
 * ingestion but useless as evidence: if all consumers present identical bytes,
 * any consumer can forge any other's events, and "an authenticated consumer ran
 * this agent" cannot be asserted about a specific installation. So each
 * installation gets its OWN token (consumer_installations, migration 0045),
 * hashed at rest. No token value is shared with the other three boundaries —
 * only the extraction and constant-time comparison mechanics are reused.
 *
 * ── Fail-closed ─────────────────────────────────────────────────────────────
 * An unauthenticated event is NOT ingested. An unknown or revoked installation
 * is refused and is NEVER created on the strength of an anonymous POST —
 * provisioning is a deliberate operator act, not a side effect of ingestion.
 *
 * ── Hostile payload ─────────────────────────────────────────────────────────
 * Same posture as the sibling route, applied to the new fields: 16 KB cap,
 * strict Zod schema, secret-pattern scan, and NOTHING echoed back — not a field
 * name, not an err.message, not which of the checks refused. Every rejection is
 * a generic body.
 */

const MAX_PAYLOAD_BYTES = 16 * 1024
const MAX_FIELD_LENGTH = 500

const boundedString = (max = MAX_FIELD_LENGTH) => z.string().trim().min(1).max(max)

const consumerEventTypeEnum = z.enum(CONSUMER_EVENT_TYPES)
const environmentEnum = z.enum(['production', 'staging', 'development'])

const usageSchema = z
  .object({
    inputTokens: z.number().int().min(0).max(100_000_000).optional(),
    outputTokens: z.number().int().min(0).max(100_000_000).optional(),
    totalTokens: z.number().int().min(0).max(100_000_000).optional(),
  })
  .strict()

const errorSchema = z
  .object({
    name: boundedString().optional(),
    code: boundedString().optional(),
    messageHash: boundedString().optional(),
    category: z.enum(['provider_error', 'timeout', 'validation', 'tool_error', 'unknown']).optional(),
  })
  .strict()

/**
 * Mandatory identifiers. All six are required on EVERY event type — a report
 * that cannot say which project/copilot/version/run/installation/environment it
 * describes is not evidence of anything, so it is rejected rather than stored
 * as a partially-identified row.
 */
const consumerTelemetryEventSchema = z
  .object({
    eventId: boundedString(),
    eventType: consumerEventTypeEnum,
    projectId: boundedString(),
    copilotId: boundedString(),
    versionId: boundedString(),
    runId: boundedString(),
    installationId: boundedString(),
    environment: environmentEnum,
    timestamp: boundedString(),
    latencyMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
    usage: usageSchema.optional(),
    error: errorSchema.optional(),
  })
  .strict()

type ConsumerTelemetryEvent = z.infer<typeof consumerTelemetryEventSchema>

// Same high-signal patterns as the sibling route. Defense in depth: the emitter
// SDK is contractually forbidden from sending raw secrets, and this route does
// not trust it.
const SECRET_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9_-]{8,}/,
  /ghp_[a-zA-Z0-9]{8,}/,
  /eyJ[a-zA-Z0-9_-]{8,}/,
  /-----BEGIN/,
  /Authorization:\s*Bearer/i,
  /Bearer\s+[a-zA-Z0-9_.-]{16,}/,
]

function containsSuspiciousContent(value: unknown, depth = 0): boolean {
  if (depth > 10) return true
  if (typeof value === 'string') return SECRET_PATTERNS.some((re) => re.test(value))
  if (Array.isArray(value)) return value.some((item) => containsSuspiciousContent(item, depth + 1))
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) => containsSuspiciousContent(v, depth + 1))
  }
  return false
}

/**
 * Map a consumer event type onto the `status` column, which migration 0017
 * constrains to started/completed/failed. Non-run events are lifecycle signals
 * with no run outcome; they are recorded as `started` and distinguished by
 * `event_type`, which is the column that actually carries the meaning.
 */
function statusForEventType(eventType: ConsumerTelemetryEvent['eventType']): 'started' | 'completed' | 'failed' {
  if (eventType === 'consumer.run_completed') return 'completed'
  if (eventType === 'consumer.run_failed') return 'failed'
  return 'started'
}

export async function POST(request: Request) {
  // Size first: cap hostile input before parsing it.
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

  const result = consumerTelemetryEventSchema.safeParse(parsedJson)
  if (!result.success) {
    // Never name the offending field — a validation oracle is a mapping aid.
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 })
  }
  const event = result.data

  if (containsSuspiciousContent(event)) {
    return NextResponse.json({ error: 'payload rejected: suspicious content' }, { status: 400 })
  }

  const providedToken = extractBearerToken(request, 'x-aigent-installation-token')

  let installation
  try {
    installation = await authenticateInstallation(providedToken, event.installationId)
  } catch (err) {
    console.error(
      '[consumer-telemetry] installation lookup failed',
      err instanceof Error ? err.message : err
    )
    return NextResponse.json({ error: 'internal error' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }

  // One generic 401 for: no token, malformed token, unknown hash, revoked
  // installation, and token/installationId mismatch. Distinguishing them would
  // let a caller enumerate valid installations.
  if (!installation) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // An installation speaks only for its own copilot and its own environment.
  // A valid staging token cannot report production activity.
  if (installation.copilotId !== event.copilotId || installation.environment !== event.environment) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    await pgrest('POST', 'runtime_telemetry_events', {
      id: event.eventId,
      project_id: event.projectId,
      agent_id: event.copilotId,
      agent_version: event.versionId,
      version_id: event.versionId,
      run_id: event.runId,
      installation_id: installation.id,
      event_type: event.eventType,
      received_at: event.timestamp,
      status: statusForEventType(event.eventType),
      latency_ms: event.latencyMs ?? null,
      // Provider/model are NOT reported by the consumer channel and are never
      // guessed: a fabricated provider would produce a fabricated cost.
      provider: null,
      model: null,
      input_shape: {},
      output_shape: {},
      error: event.error ?? {},
      usage: event.usage ?? {},
      // `source: 'consumer'` is what classifyRuntimeTelemetryProvenance already
      // recognises — this route is the first emitter in the repo to write it.
      environment: { source: 'consumer', consumerEnvironment: event.environment },
    })
  } catch (err) {
    const status = (err as { status?: number })?.status
    if (status === 409 || /23505|duplicate key/i.test(String((err as Error)?.message))) {
      // Idempotent re-delivery of an event that already landed.
      return NextResponse.json({ ok: true, deduplicated: true }, { status: 202 })
    }
    console.error('[consumer-telemetry] insert failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'internal error' }, { status: isPgrestTimeout(err) ? 504 : 500 })
  }

  // Bookkeeping only after the event durably landed. Fail-soft inside.
  await touchInstallationSeen(
    installation.id,
    event.timestamp,
    event.eventType === 'consumer.version_loaded'
      ? { versionId: event.versionId, at: event.timestamp }
      : undefined
  )

  return NextResponse.json({ ok: true }, { status: 202 })
}
