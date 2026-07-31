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
    /**
     * The consumer's CLAIMED event time. Must be a real ISO-8601 datetime — it
     * used to be an unvalidated bounded string, so 'hello-not-a-date' and
     * '2999-01-01' both stored fine. It is untrusted either way (see
     * `reported_at` below): validating it only keeps garbage out of a
     * timestamptz column, it does not make the value authoritative.
     */
    timestamp: z.string().datetime({ offset: true }),
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
/**
 * Tolerance for a consumer clock running ahead of ours. Modest skew is normal
 * on unsynchronised machines; a claim beyond it is rejected rather than stored,
 * so `reported_at` can never hold a date that has not happened.
 */
const MAX_CLOCK_SKEW_AHEAD_MS = 5 * 60 * 1000

/**
 * Namespace a consumer-chosen event id into the installation that reported it.
 *
 * `runtime_telemetry_events.id` is a primary key SHARED with Aigent's internal
 * emitters. A caller-chosen id there is a cross-tenant write primitive; scoping
 * it to the authenticated installation makes collisions impossible between
 * installations while preserving per-installation idempotency.
 */
export function consumerEventRowId(installationId: string, eventId: string): string {
  return `consumer:${installationId}:${eventId}`
}

/**
 * How far back a claimed event time may plausibly reach. Anything older is a
 * malformed or replayed report, not a late delivery.
 */
const MAX_CLAIM_AGE_MS = 30 * 24 * 60 * 60 * 1000

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

  // Secret scan runs on the RAW body, BEFORE parsing.
  //
  // It used to run on `result.data` — i.e. after a .strict() parse had already
  // dropped every unknown key and coerced the shape. A secret smuggled in a
  // field the schema does not declare was stripped before the scanner could
  // ever see it, so the "defense in depth" was decorative: it only re-checked
  // values Zod had already accepted. Scanning the raw text is the only place
  // this check can observe what the caller actually sent.
  if (SECRET_PATTERNS.some((re) => re.test(rawBody))) {
    return NextResponse.json({ error: 'payload rejected: suspicious content' }, { status: 400 })
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

  // Retained as a second pass over the parsed structure. Cheap, and it still
  // catches a pattern that only becomes visible after JSON unescaping.
  if (containsSuspiciousContent(event)) {
    return NextResponse.json({ error: 'payload rejected: suspicious content' }, { status: 400 })
  }

  // Clock sanity on the CLAIMED time, before it reaches a timestamptz column.
  // This does not grant the value authority — `received_at` is still server
  // clock — it only refuses impossible claims.
  const serverNow = new Date()
  const claimedMs = Date.parse(event.timestamp)
  if (
    !Number.isFinite(claimedMs) ||
    claimedMs > serverNow.getTime() + MAX_CLOCK_SKEW_AHEAD_MS ||
    claimedMs < serverNow.getTime() - MAX_CLAIM_AGE_MS
  ) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 })
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

  // An installation speaks only for its own project, its own copilot and its
  // own environment. A valid staging token cannot report production activity,
  // and no token can write a row under someone else's project.
  //
  // `projectId` used to be written straight through unchecked while the comment
  // here already claimed the wider guarantee. Any valid installation could
  // therefore file events under an arbitrary project id and pollute every
  // aggregation keyed (project_id, agent_id).
  //
  // A null project_id means the installation predates provisioning of that
  // column: it is UNPROVISIONED, not "allowed to claim anything". Fail closed.
  if (
    installation.projectId === null ||
    installation.projectId !== event.projectId ||
    installation.copilotId !== event.copilotId ||
    installation.environment !== event.environment
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    await pgrest('POST', 'runtime_telemetry_events', {
      // NAMESPACED BY INSTALLATION. The caller does not choose a primary key in
      // a table it shares with Aigent's internal emitters. Writing the raw
      // eventId let a consumer (a) squat the PK of another tenant's — or an
      // internal — event, whose later insert then failed while this route
      // answered 202 {deduplicated:true}, making the suppression invisible to
      // the legitimate emitter, and (b) probe which ids already exist through
      // the dedup/insert distinction. Prefixing keeps idempotency exactly as
      // strong WITHIN the installation's own namespace, which is the only
      // scope where replay of "the same event" is meaningful.
      id: consumerEventRowId(installation.id, event.eventId),
      project_id: event.projectId,
      agent_id: event.copilotId,
      // UNVERIFIED CLAIM. This is the version string the consumer says it was
      // running; it is NOT confronted with copilot_versions. Verifying per
      // event would add a database round-trip to the hot ingestion path for a
      // field no decision depends on, so the choice is to keep it cheap and
      // mark it untrusted rather than to imply a check that is not performed.
      // `versionClaimVerified: false` below travels with the row so no reader
      // can present it as an observed fact — see the read contract.
      agent_version: event.versionId,
      version_id: event.versionId,
      run_id: event.runId,
      installation_id: installation.id,
      event_type: event.eventType,
      // SERVER CLOCK, always. This column drives every recency/activation
      // window; a client-supplied value made that window attacker-controlled
      // (one event dated 2999 pinned activeInConsumer=true permanently, since
      // the 7-day expiry could never fire). The caller's claim is kept
      // separately in `reported_at`, where nothing depends on it.
      received_at: serverNow.toISOString(),
      reported_at: event.timestamp,
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
      environment: {
        source: 'consumer',
        consumerEnvironment: event.environment,
        // Travels with the row so a reader cannot mistake a claim for an
        // observation. See the `agent_version` note above.
        versionClaimVerified: false,
      },
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
  // Server clock here too: `last_seen_at` is "when Aigent verified a report",
  // which is a measurement. Feeding it the caller's claim would have let a
  // consumer date its own last contact arbitrarily, including in the future.
  const seenAt = serverNow.toISOString()
  await touchInstallationSeen(
    installation.id,
    seenAt,
    event.eventType === 'consumer.version_loaded'
      ? { versionId: event.versionId, at: seenAt }
      : undefined
  )

  return NextResponse.json({ ok: true }, { status: 202 })
}
