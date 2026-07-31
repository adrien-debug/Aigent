/**
 * Agent Mission Control — consumer activation read (server only).
 *
 * Answers one question honestly: what do we actually KNOW about a copilot's
 * life inside a consumer workspace?
 *
 * Until this module existed, the answer was structurally `'unknown'`: Aigent had
 * no authenticated consumer channel, so there was nothing to read. Now there is
 * one — but the honest default does not change. `unknown` remains what we
 * report in the absence of proof, and it is NEVER downgraded to `false`.
 *
 * ── The three-valued rule ───────────────────────────────────────────────────
 *   true     an AUTHENTICATED consumer event proves execution, and it is RECENT
 *   unknown  no authenticated consumer event, or the newest one is stale
 *   false    NEVER returned by this module
 *
 * Why `false` is never returned: silence from a consumer is ambiguous. An agent
 * that is deployed and idle, a consumer whose network is down, and a consumer
 * that uninstalled the agent all produce exactly the same signal — none. Saying
 * `false` would assert a fact ("it is not active") that we did not measure.
 * Absence of evidence is recorded as absence of evidence.
 *
 * ── What "recent" means ─────────────────────────────────────────────────────
 * ACTIVATION_RECENCY_WINDOW_MS = 7 days.
 *
 * Chosen against the heartbeat contract: a consumer runtime emits
 * `consumer.heartbeat` on an interval far shorter than a week, so a healthy
 * installation refreshes its proof many times over inside the window. Seven days
 * therefore tolerates a weekend outage, a paused staging environment, or a
 * low-traffic agent that only runs on weekdays, without ever letting a
 * months-old event masquerade as current activity. Past the window the claim
 * expires back to `unknown` — not to `false`: we stop knowing, we do not learn
 * the opposite.
 *
 * The window is exported and echoed in every result (`recencyWindowMs`,
 * `recencyWindowDays`) so a reader never has to guess the threshold a verdict
 * was measured against.
 *
 * Never import from a client component (reads the service-role key).
 */
import 'server-only'

import { pgrest } from './postgrest'

/**
 * How recent an authenticated consumer event must be to still prove activation.
 * 7 days — see the module header for the reasoning.
 */
export const ACTIVATION_RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** The same window in days, for display. */
export const ACTIVATION_RECENCY_WINDOW_DAYS = ACTIVATION_RECENCY_WINDOW_MS / (24 * 60 * 60 * 1000)

/**
 * Consumer-reported event vocabulary. These are the ONLY event types the
 * authenticated consumer channel accepts.
 */
export const CONSUMER_EVENT_TYPES = [
  'consumer.installation_seen',
  'consumer.version_loaded',
  'consumer.run_started',
  'consumer.run_completed',
  'consumer.run_failed',
  'consumer.heartbeat',
] as const

export type ConsumerEventType = (typeof CONSUMER_EVENT_TYPES)[number]

/**
 * Event types that prove the agent actually EXECUTED at the consumer, as
 * opposed to merely being installed or reachable.
 *
 * A heartbeat proves the runtime is alive; it does not prove the agent ran. The
 * distinction is kept because "installed but never invoked" is a real and
 * important product state — collapsing it into "active" would overstate adoption.
 */
const EXECUTION_EVENT_TYPES = new Set<ConsumerEventType>([
  'consumer.run_started',
  'consumer.run_completed',
  'consumer.run_failed',
])

/**
 * Observation stages, from weakest to strongest. Each is a FACT about what was
 * reported — never an inference from what Aigent did on its own side.
 */
export type ConsumerObservationStage =
  /** No authenticated consumer event has ever arrived. A fact, not a failure. */
  | 'never_observed'
  /** The installation authenticated at least once. */
  | 'installation_observed'
  /** The consumer reported LOADING a specific version. */
  | 'version_loaded'
  /** The consumer reported an actual run. */
  | 'execution_observed'

export interface ConsumerActivationRead {
  copilotId: string
  /**
   * Was the agent ever pushed to a consumer? Supplied by the caller from
   * `agent_delivery_events` — a delivery proves a PUSH and nothing more. It is
   * deliberately never promoted into an activation claim.
   */
  delivered: boolean
  stage: ConsumerObservationStage
  /**
   * Three-valued. `true` only on recent + authenticated execution proof.
   * `'unknown'` otherwise. NEVER `false`.
   */
  activeInConsumer: true | 'unknown'
  /** Newest authenticated consumer event timestamp, or null if never observed. */
  lastActivityAt: string | null
  /** Newest event type observed, or null. */
  lastEventType: ConsumerEventType | null
  /** Version the consumer reported loading, or null. Never guessed. */
  lastVersionLoaded: string | null
  /** Number of installations that have ever authenticated for this copilot. */
  observedInstallationCount: number
  /** True when execution proof exists but is older than the recency window. */
  staleEvidence: boolean
  recencyWindowMs: number
  recencyWindowDays: number
  /** Plain-language justification of the verdict, for operators and logs. */
  reason: string
}

interface ConsumerEventRow {
  event_type?: unknown
  received_at?: unknown
  installation_id?: unknown
  version_id?: unknown
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isConsumerEventType(value: unknown): value is ConsumerEventType {
  return typeof value === 'string' && (CONSUMER_EVENT_TYPES as readonly string[]).includes(value)
}

/**
 * Derive the activation read from authenticated consumer events.
 *
 * Pure — no I/O — so the recency rule is directly testable without a backend.
 * `rows` MUST already be filtered to `installation_id is not null`: this
 * function trusts that every row it sees was authenticated, and rows lacking an
 * installation id are defensively ignored rather than counted as proof.
 */
export function deriveConsumerActivation(
  copilotId: string,
  rows: ConsumerEventRow[],
  options: { delivered: boolean; now?: Date }
): ConsumerActivationRead {
  const now = options.now ?? new Date()
  const windowFloor = now.getTime() - ACTIVATION_RECENCY_WINDOW_MS

  const base = {
    copilotId,
    delivered: options.delivered,
    recencyWindowMs: ACTIVATION_RECENCY_WINDOW_MS,
    recencyWindowDays: ACTIVATION_RECENCY_WINDOW_DAYS,
  }

  // Only authenticated rows count. An event without an installation id came
  // from an internal emitter (or is malformed) and proves nothing about a
  // consumer.
  const authenticated = rows.filter((row) => asString(row.installation_id) !== null)

  if (authenticated.length === 0) {
    return {
      ...base,
      stage: 'never_observed',
      activeInConsumer: 'unknown',
      lastActivityAt: null,
      lastEventType: null,
      lastVersionLoaded: null,
      observedInstallationCount: 0,
      staleEvidence: false,
      reason: options.delivered
        ? 'Delivered to a consumer, but no authenticated consumer event has ever arrived. A push proves ' +
          'delivery, never activation — this stays unknown, not false.'
        : 'No authenticated consumer event has ever arrived, and no delivery is recorded.',
    }
  }

  const installations = new Set<string>()
  let newestAt: string | null = null
  let newestMs = Number.NEGATIVE_INFINITY
  let newestType: ConsumerEventType | null = null
  let lastVersionLoaded: string | null = null
  let lastVersionLoadedMs = Number.NEGATIVE_INFINITY
  let sawVersionLoaded = false
  let newestExecutionMs = Number.NEGATIVE_INFINITY

  for (const row of authenticated) {
    const installationId = asString(row.installation_id)
    if (installationId) installations.add(installationId)

    const receivedAt = asString(row.received_at)
    const ms = receivedAt ? Date.parse(receivedAt) : Number.NaN
    if (!Number.isFinite(ms)) continue

    const eventType = isConsumerEventType(row.event_type) ? row.event_type : null

    if (ms > newestMs) {
      newestMs = ms
      newestAt = receivedAt
      newestType = eventType
    }

    if (eventType === 'consumer.version_loaded') {
      sawVersionLoaded = true
      const versionId = asString(row.version_id)
      if (versionId && ms > lastVersionLoadedMs) {
        lastVersionLoadedMs = ms
        lastVersionLoaded = versionId
      }
    }

    if (eventType && EXECUTION_EVENT_TYPES.has(eventType) && ms > newestExecutionMs) {
      newestExecutionMs = ms
    }
  }

  const hasExecution = Number.isFinite(newestExecutionMs)
  const executionIsRecent = hasExecution && newestExecutionMs >= windowFloor

  const stage: ConsumerObservationStage = hasExecution
    ? 'execution_observed'
    : sawVersionLoaded
      ? 'version_loaded'
      : 'installation_observed'

  // The single place the verdict is decided. Note the absent `false` branch:
  // it does not exist by construction, not by omission.
  const activeInConsumer: true | 'unknown' = executionIsRecent ? true : 'unknown'

  const staleEvidence = hasExecution && !executionIsRecent

  const windowLabel = `${ACTIVATION_RECENCY_WINDOW_DAYS}-day`
  const reason = executionIsRecent
    ? `An authenticated consumer reported a run within the ${windowLabel} recency window (latest activity ${newestAt}).`
    : staleEvidence
      ? `Authenticated execution proof exists but is older than the ${windowLabel} recency window — the claim ` +
        'expired back to unknown. Expiry means we stopped knowing, not that the agent is inactive.'
      : sawVersionLoaded
        ? `An authenticated consumer loaded a version but never reported a run, so execution is unproven ` +
          `(unknown, not false).`
        : 'An authenticated installation was observed but it never reported loading a version or running.'

  return {
    ...base,
    stage,
    activeInConsumer,
    lastActivityAt: newestAt,
    lastEventType: newestType,
    lastVersionLoaded,
    observedInstallationCount: installations.size,
    staleEvidence,
    reason,
  }
}

/**
 * Read the activation state for one copilot from the live backend.
 *
 * Reads ONLY authenticated rows (`installation_id=not.is.null`) — the database
 * filter is the same invariant `deriveConsumerActivation` re-checks in memory.
 *
 * Throws on a hard PostgREST error, same contract as the other telemetry reads:
 * a lookup failure is `unknown`-by-exception for the caller to handle, never a
 * silent "never observed" (which would fabricate an absence we did not measure).
 */
export async function readConsumerActivation(
  copilotId: string,
  options: { delivered: boolean; now?: Date }
): Promise<ConsumerActivationRead> {
  const rows = (await pgrest(
    'GET',
    `runtime_telemetry_events?agent_id=eq.${encodeURIComponent(copilotId)}` +
      '&installation_id=not.is.null' +
      '&select=event_type,received_at,installation_id,version_id' +
      '&order=received_at.desc&limit=500'
  )) as ConsumerEventRow[]

  return deriveConsumerActivation(copilotId, Array.isArray(rows) ? rows : [], options)
}
