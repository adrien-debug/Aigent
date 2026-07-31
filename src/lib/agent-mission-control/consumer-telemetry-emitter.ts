/**
 * Consumer telemetry emitter — the client half of the feedback channel.
 *
 * ── Where this lives, and why ───────────────────────────────────────────────
 * This file sits in src/lib/agent-mission-control/ next to the rest of the
 * telemetry domain, but it is the ONLY module in that directory that is NOT
 * server-only. It is deliberately written to be COPIED INTO, or vendored by, a
 * consumer's deployed runtime — it is the reference implementation of the wire
 * contract, and it is the file to hand a consumer team.
 *
 * That imposes three hard constraints, all load-bearing:
 *   1. NO `import 'server-only'`. It must run inside a consumer process.
 *   2. NO import of postgrest.ts, the service-role key, or any Aigent internal.
 *      It speaks HTTP to a public route and nothing else.
 *   3. NO dependency beyond `fetch`. It must drop into a Node, edge, or
 *      serverless runtime without a package install.
 * Keeping it beside the schema it must match is what stops the wire contract
 * from drifting — the route's Zod schema and this emitter's payload type are
 * meant to be read side by side.
 *
 * ── Secrets ─────────────────────────────────────────────────────────────────
 * The installation token is read from the environment by the CONSUMER
 * (AIGENT_INSTALLATION_TOKEN) and passed in. It is never logged, never included
 * in an error message, and never written to disk by this module.
 *
 * ── Fail-soft, always ───────────────────────────────────────────────────────
 * Telemetry must never break the consumer's product. Every failure path —
 * network down, 401, 500, timeout, Aigent entirely unreachable — is swallowed
 * and reported as a boolean. The emitter has no retry storm: one attempt, one
 * timeout, done. Aigent losing an event is strictly better than a consumer's
 * agent throwing because its telemetry sink was unavailable.
 */

/** Event vocabulary. Mirrors CONSUMER_EVENT_TYPES in consumer-activation.ts. */
export type ConsumerEmitterEventType =
  | 'consumer.installation_seen'
  | 'consumer.version_loaded'
  | 'consumer.run_started'
  | 'consumer.run_completed'
  | 'consumer.run_failed'
  | 'consumer.heartbeat'

export type ConsumerEmitterEnvironment = 'production' | 'staging' | 'development'

/**
 * Identity of one installation. Every field is mandatory: an event that cannot
 * say what it describes is not evidence, and the route rejects it.
 */
export interface ConsumerEmitterIdentity {
  /** Aigent ingestion base URL, e.g. https://aigent.example.com */
  endpoint: string
  /** Per-installation token. Never shared between installations or environments. */
  token: string
  projectId: string
  copilotId: string
  versionId: string
  installationId: string
  environment: ConsumerEmitterEnvironment
}

export interface ConsumerEmitOptions {
  runId: string
  latencyMs?: number
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  /** Sanitized error summary. NEVER a raw message, stack trace, or prompt. */
  error?: {
    name?: string
    code?: string
    /** A hash of the message — not the message. */
    messageHash?: string
    category?: 'provider_error' | 'timeout' | 'validation' | 'tool_error' | 'unknown'
  }
  /** Per-call timeout. One attempt only — no retries by design. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 5_000

/**
 * Recommended heartbeat interval: 1 hour.
 *
 * Far shorter than the 7-day activation recency window in
 * consumer-activation.ts, so a healthy installation refreshes its proof ~168
 * times before the window could ever expire. That margin is the point: a
 * consumer must be genuinely, durably silent — not merely briefly unlucky —
 * before Aigent stops claiming activation.
 */
export const RECOMMENDED_HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000

function randomEventId(): string {
  // crypto.randomUUID is available in Node 19+, modern browsers, and edge
  // runtimes. The fallback keeps the emitter dependency-free on older hosts;
  // event ids are de-duplication keys, not security tokens.
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (typeof cryptoRef?.randomUUID === 'function') return `cevt_${cryptoRef.randomUUID()}`
  return `cevt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

/**
 * Emit one consumer telemetry event.
 *
 * Returns true only when Aigent acknowledged (2xx). Never throws — see the
 * fail-soft note in the module header.
 */
export async function emitConsumerTelemetryEvent(
  identity: ConsumerEmitterIdentity,
  eventType: ConsumerEmitterEventType,
  options: ConsumerEmitOptions
): Promise<boolean> {
  const payload = {
    eventId: randomEventId(),
    eventType,
    projectId: identity.projectId,
    copilotId: identity.copilotId,
    versionId: identity.versionId,
    runId: options.runId,
    installationId: identity.installationId,
    environment: identity.environment,
    timestamp: new Date().toISOString(),
    ...(options.latencyMs !== undefined ? { latencyMs: options.latencyMs } : {}),
    ...(options.usage ? { usage: options.usage } : {}),
    ...(options.error ? { error: options.error } : {}),
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const response = await fetch(
      `${identity.endpoint.replace(/\/+$/, '')}/api/runtime-telemetry/consumer`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The token travels in the Authorization header only. It is never
          // placed in a URL, a query string, or a log line.
          authorization: `Bearer ${identity.token}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }
    )
    return response.ok
  } catch {
    // Swallowed on purpose: a telemetry failure must never surface into the
    // consumer's product. No error detail is logged — it could carry the URL
    // with credentials attached by an intermediary.
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Convenience wrapper: report a completed run.
 *
 * The three run events are what actually prove activation — heartbeats and
 * installation pings prove only that the runtime is alive, which is a weaker
 * claim that consumer-activation.ts keeps deliberately separate.
 */
export function emitConsumerRunCompleted(
  identity: ConsumerEmitterIdentity,
  options: ConsumerEmitOptions
): Promise<boolean> {
  return emitConsumerTelemetryEvent(identity, 'consumer.run_completed', options)
}

/** Convenience wrapper: report a failed run with a sanitized error summary. */
export function emitConsumerRunFailed(
  identity: ConsumerEmitterIdentity,
  options: ConsumerEmitOptions
): Promise<boolean> {
  return emitConsumerTelemetryEvent(identity, 'consumer.run_failed', options)
}

/**
 * Build an identity from a consumer's environment variables.
 *
 * Returns null when anything is missing — the emitter then does nothing at all,
 * which is the correct fail-closed behaviour for an unconfigured consumer: no
 * partial identity is ever invented to make a call succeed.
 */
export function consumerIdentityFromEnv(
  env: Record<string, string | undefined>
): ConsumerEmitterIdentity | null {
  const endpoint = env.AIGENT_TELEMETRY_ENDPOINT
  const token = env.AIGENT_INSTALLATION_TOKEN
  const projectId = env.AIGENT_PROJECT_ID
  const copilotId = env.AIGENT_COPILOT_ID
  const versionId = env.AIGENT_VERSION_ID
  const installationId = env.AIGENT_INSTALLATION_ID
  const environment = env.AIGENT_ENVIRONMENT

  if (!endpoint || !token || !projectId || !copilotId || !versionId || !installationId) return null
  if (environment !== 'production' && environment !== 'staging' && environment !== 'development') return null

  return { endpoint, token, projectId, copilotId, versionId, installationId, environment }
}
