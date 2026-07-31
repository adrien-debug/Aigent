/**
 * telemetry-health.ts — pure diagnostic for the runtime telemetry loop.
 *
 * The loop is opt-in at THREE independent levels, any one of which silently
 * kills it with zero signal today:
 *   1. Manifest-level: a delivered agent's manifest declares telemetry.
 *   2. Consumer-level: the delivered agent's runtime process actually turns
 *      it on (AIGENT_TELEMETRY_ENABLED=true + AIGENT_TELEMETRY_ENDPOINT/TOKEN
 *      set in the CONSUMER repo — see .env.example, consumer-bootstrap.ts).
 *   3. Aigent-level: AIGENT_RUNTIME_TELEMETRY_TOKEN configured here, gating
 *      POST /api/runtime-telemetry (src/app/api/runtime-telemetry/route.ts).
 *
 * This module does NOT read env vars, hit the DB, or make network calls. The
 * caller loads that state (env presence, agent counts, last-event timestamp)
 * and passes it in, so the diagnostic itself stays deterministic and testable
 * without a live backend.
 *
 * DOCTRINE: "zero events received" is NEVER evidence that agents are not
 * running. It only ever means the loop produced no observable signal for the
 * window considered — level 1/2/3 opt-out, an outage, or genuinely idle
 * agents are all indistinguishable from here. The diagnostic must never say
 * "agents are inactive" — only "the telemetry loop is silent" / "data
 * unavailable". Callers rendering this MUST preserve that distinction.
 */

/** Input state, already loaded by the caller (env read, DB query, or both). */
export interface TelemetryHealthInput {
  /** Whether AIGENT_RUNTIME_TELEMETRY_TOKEN is set on the Aigent server (ingestion gate, level 3). */
  ingestionTokenConfigured: boolean
  /**
   * Count of agents/copilots whose manifest declares telemetry (level 1).
   * `null` when this could not be determined (e.g. DB unreachable) — distinct
   * from `0` (queried successfully, genuinely none declared).
   */
  agentsWithTelemetryDeclared: number | null
  /**
   * Timestamp (ISO 8601) of the most recent runtime_telemetry_events row
   * received, across all agents. `null` if none has ever arrived, or if this
   * could not be determined — disambiguated by `lastEventLookupFailed`.
   */
  lastEventReceivedAt: string | null
  /** True when the lookup for `lastEventReceivedAt` itself failed (DB error/timeout), vs. legitimately found nothing. */
  lastEventLookupFailed: boolean
  /** Reference "now" instant (ISO 8601) — caller-supplied so the function stays pure/deterministic. */
  now: string
  /** Window, in days, after which "declared but silent" counts as muted. Default 7 if omitted by caller convention; this module requires it explicit. */
  muteThresholdDays: number
}

export type TelemetryHealthStatus =
  | 'not_configured'
  | 'incomplete_configuration'
  | 'loop_muted'
  | 'healthy'
  | 'unavailable'

export interface TelemetryHealthDiagnostic {
  status: TelemetryHealthStatus
  /** Human-readable summary, safe to render as-is. Never asserts agent activity — only loop/config state. */
  summary: string
  /** Days since the last received event, or null if never/unknown. */
  daysSinceLastEvent: number | null
  /** Always mirrors input.agentsWithTelemetryDeclared, passed through for convenience. */
  agentsWithTelemetryDeclared: number | null
}

function daysBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso)
  const to = Date.parse(toIso)
  if (Number.isNaN(from) || Number.isNaN(to)) return null
  return Math.max(0, (to - from) / (1000 * 60 * 60 * 24))
}

/**
 * Pure, deterministic diagnosis of the runtime telemetry loop's health.
 * No I/O — all facts are supplied by the caller via `input`.
 */
export function diagnoseTelemetryHealth(input: TelemetryHealthInput): TelemetryHealthDiagnostic {
  const { ingestionTokenConfigured, agentsWithTelemetryDeclared, lastEventReceivedAt, lastEventLookupFailed, now, muteThresholdDays } = input

  const daysSinceLastEvent = lastEventReceivedAt ? daysBetween(lastEventReceivedAt, now) : null

  // Level 3 off: the Aigent-side gate itself is not configured. This is
  // distinct from "loop muted" — it's not that agents stopped talking, it's
  // that Aigent would reject them with 503 even if they tried. Never phrase
  // this as agent inactivity.
  if (!ingestionTokenConfigured) {
    return {
      status: 'not_configured',
      summary:
        'Runtime telemetry ingestion is not configured on Aigent (AIGENT_RUNTIME_TELEMETRY_TOKEN unset). ' +
        'POST /api/runtime-telemetry returns 503 to any agent that tries. This says nothing about whether ' +
        'delivered agents are running — only that Aigent cannot currently receive their telemetry.',
      daysSinceLastEvent,
      agentsWithTelemetryDeclared,
    }
  }

  // We can't determine level-1 declared-agent count — don't guess a status.
  if (agentsWithTelemetryDeclared === null || lastEventLookupFailed) {
    return {
      status: 'unavailable',
      summary:
        'Telemetry health cannot be determined right now (lookup failed for declared-agent count and/or ' +
        'last-event timestamp). Data unavailable — this is not evidence the loop is silent or that agents ' +
        'are inactive.',
      daysSinceLastEvent,
      agentsWithTelemetryDeclared,
    }
  }

  // Level 3 on, but nobody at level 1 has opted in yet — nothing to expect.
  if (agentsWithTelemetryDeclared === 0) {
    return {
      status: 'incomplete_configuration',
      summary:
        'Runtime telemetry ingestion is configured, but zero delivered agents declare telemetry in their ' +
        'manifest. Nothing is expected to arrive yet — this is a configuration gap, not a muted loop.',
      daysSinceLastEvent,
      agentsWithTelemetryDeclared,
    }
  }

  // Level 1 declared, but never a single event, or none within the window.
  const neverReceived = lastEventReceivedAt === null
  const staleBeyondThreshold = daysSinceLastEvent !== null && daysSinceLastEvent > muteThresholdDays

  if (neverReceived || staleBeyondThreshold) {
    return {
      status: 'loop_muted',
      summary: neverReceived
        ? `${agentsWithTelemetryDeclared} agent(s) declare telemetry, but Aigent has never received a single ` +
          'event. This means the loop is silent (consumer opt-in off, network/config break, or an outage) — ' +
          'it does NOT mean those agents are not running.'
        : `${agentsWithTelemetryDeclared} agent(s) declare telemetry, but the most recent event received is ` +
          `${Math.floor(daysSinceLastEvent as number)} day(s) old (threshold ${muteThresholdDays}). The loop ` +
          'appears silent — this does NOT mean the agents stopped running, only that no telemetry has arrived.',
      daysSinceLastEvent,
      agentsWithTelemetryDeclared,
    }
  }

  const lastEventAge =
    daysSinceLastEvent !== null ? `${daysSinceLastEvent.toFixed(1)} day(s) ago` : 'recently'

  return {
    status: 'healthy',
    summary:
      `${agentsWithTelemetryDeclared} agent(s) declare telemetry and the loop is receiving events ` +
      `(last one ${lastEventAge}).`,
    daysSinceLastEvent,
    agentsWithTelemetryDeclared,
  }
}
