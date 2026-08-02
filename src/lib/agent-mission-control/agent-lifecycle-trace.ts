/**
 * agent-lifecycle-trace.ts — pure resolver for the governed agent lifecycle.
 *
 * Canonical stage sequence (product doctrine, not a stored enum):
 *   draft → tested → qualified → production → delivered → active in consumer
 *   → telemetry received → improvement proposed → V2 draft
 *
 * WHY THIS FILE EXISTS AND WHAT IT REFUSES TO DO. Five different tables each
 * hold one fact: `copilot_versions.stage` (Aigent's own pointer), a persisted
 * scores blob (tests/benchmark/shadow, `scoresEvidence`), `agent_delivery_events`
 * (a push happened), the CONSUMER's own runtime (never queried from here — no
 * such channel exists, see AGENTS.md "Shipping & télémétrie"), and
 * `runtime_telemetry_events` (a report arrived, from *some* source, self-reported
 * version). Collapsing those into one "status" word is exactly the bug
 * `agent-detail.ts`'s header comment describes for run status: two truths
 * wearing one label. This module refuses to do that. Every stage below carries
 * its OWN `StageEvidence` — `source` names the table/module it came from,
 * `state` is `'measured' | 'unknown'`, never a collapsed guess.
 *
 * DELIVERED ≠ DEPLOYED. A delivery event proves Aigent pushed a commit or
 * opened a PR (`agent_delivery_events`). It proves NOTHING about whether the
 * consumer repo merged it, deployed it, or even looked at it. This module
 * never calls a delivered agent "deployed" or "live" — only "delivered", with
 * the PR/commit facts attached.
 *
 * PRODUCTION (AIGENT) ≠ ACTIVE (CONSUMER). `copilot_versions.stage ===
 * 'production'` and `copilots.production_version_id` are Aigent-side pointers:
 * they say Aigent considers this version the one to ship. They say NOTHING
 * about a consumer's own activation state, and they never will.
 *
 * ACTIVE IN CONSUMER — ONE admissible source, and it is not this module. Since
 * the authenticated consumer channel exists (`/api/runtime-telemetry/consumer`
 * writes rows carrying an `installation_id` verified in constant time against a
 * hashed token), `active_in_consumer` is no longer structurally unknowable. But
 * the only thing allowed to decide it is `consumer-activation.ts`
 * (`readConsumerActivation` / `deriveConsumerActivation`). This resolver COPIES
 * that verdict; it never computes one.
 *
 * Specifically, `active_in_consumer.reached` must NEVER be derived from
 * `delivery`, from `currentVersion.stage`, from telemetry that lacks an
 * installation id, or from any boolean this module has on hand. A push is not
 * an activation; a production pointer is not an activation; an internal run
 * report is not an activation. And the verdict is NEVER `false` — silence from a
 * consumer is ambiguous (idle agent, network outage, uninstalled agent all look
 * identical), so absence of evidence is recorded as `'unknown'`.
 *
 * A LOOKUP FAILURE IS NOT AN ABSENCE. When the activation read itself throws,
 * this stage reports `'unavailable'`, never `'unknown'`. "I could not read" and
 * "I read, and there was nothing" are different facts and the surfaces render
 * them differently.
 *
 * TELEMETRY RECEIVED ≠ AGENT HEALTHY. A `runtime_telemetry_events` row proves a
 * report arrived. It says nothing about whether the agent is well: see
 * `telemetry-health.ts`'s own doctrine note, reused verbatim here. This module
 * exposes `lastReportedVersion` and `lastEventReceivedAt` as bare facts and
 * explicitly does NOT synthesize a health verdict — callers wanting health call
 * `diagnoseTelemetryHealth` directly and render its `TelemetryHealthStatus`
 * next to, never instead of, this trace.
 *
 * VERSION DRIFT. `lastDeliveredVersionLabel` (from the delivery event's
 * `versionId`, resolved against `versions`) and `lastReportedVersion` (the
 * self-reported `agent_version` string on the most recent telemetry event) are
 * compared ONLY when both are measured. A mismatch is `driftDetected: true` —
 * an operator-visible fact, not silently normalised away. Neither side is ever
 * defaulted to the other to manufacture agreement.
 *
 * No I/O in this module — every fact is caller-supplied, exactly like
 * `telemetry-health.ts`. Deterministic, unit-testable without a DB.
 */

import type { CopilotVersion } from './types'
import type { DeliveryEvent } from './delivery-events-store'
import type { ConsumerActivationRead } from './consumer-activation'

export type EvidenceState = 'measured' | 'unknown'

/**
 * A stage's evidence can additionally be `'unavailable'`: the lookup that would
 * have produced it FAILED. That is not `'unknown'` — "I could not read" is a
 * different fact from "I read, and there was nothing to find" — and collapsing
 * the two would turn an outage into a calm product state.
 */
export type StageEvidenceState = EvidenceState | 'unavailable'

export interface StageEvidence {
  /** Where this fact came from — a table or module name, not a guess. */
  source: string
  state: StageEvidenceState
  /** Human-readable, safe to render as-is. Never asserts beyond what `state: 'measured'` proves. */
  detail: string
}

export interface LifecycleStage {
  key:
    | 'draft'
    | 'tested'
    | 'qualified'
    | 'production'
    | 'delivered'
    | 'active_in_consumer'
    | 'telemetry_received'
    | 'improvement_proposed'
    | 'v2_draft'
  label: string
  /**
   * `true` / `false` — measured. `'unknown'` — read, nothing conclusive.
   * `'unavailable'` — the read itself failed.
   *
   * `active_in_consumer` never takes `false` by any branch: see the header.
   */
  reached: boolean | 'unknown' | 'unavailable'
  evidence: StageEvidence
  /**
   * Only populated on `active_in_consumer`. Carries the proof timestamp and the
   * staleness flag so a surface can render BOTH without re-deriving anything.
   */
  consumer?: ConsumerStageFacts
}

/**
 * The consumer-activation facts a surface must be able to render: the verdict's
 * reason, when the last authenticated proof arrived, and whether that proof is
 * stale. `stale` is carried explicitly rather than inferred from a date, so no
 * surface has to re-implement the recency window.
 */
export interface ConsumerStageFacts {
  reason: string
  /** Newest AUTHENTICATED consumer event timestamp, or null. */
  lastActivityAt: string | null
  /** True when execution proof exists but fell outside the recency window. */
  stale: boolean
  /** How many installations ever authenticated, or null when the read failed. */
  observedInstallationCount: number | null
  /**
   * How far back proof still counts, in days — echoed so a reader never has to
   * guess the threshold a verdict was measured against.
   */
  recencyWindowDays: number | null
}

export interface VersionDriftReport {
  /** `unknown` when either side lacks a measured value — never guessed as "no drift". */
  state: EvidenceState
  lastDeliveredVersionId: string | null
  lastDeliveredVersionLabel: string | null
  lastReportedVersion: string | null
  /** Exact comparison verdict (version id and label), null when drift is unknown. */
  versionsMatch: boolean | null
  driftDetected: boolean
  detail: string
}

export interface LifecycleTraceInput {
  versions: CopilotVersion[]
  currentVersion: CopilotVersion | undefined
  delivery: DeliveryEvent | null
  /** From `runtime_telemetry_events`, most recent row for this copilot — or `null` if none/unknown. */
  lastTelemetry: { agentVersion: string | null; receivedAt: string } | null
  /** True when the telemetry lookup itself failed (DB error) — distinct from "queried, none found". */
  telemetryLookupFailed: boolean
  /** True when this copilot has a pending/created V2 draft (improvement-loop artifact). */
  hasV2Draft: boolean
  /** True when an improvement analysis/proposal exists for this copilot (improvement-loop artifact). */
  hasImprovementProposal: boolean
  /**
   * The verdict from `consumer-activation.ts` — the ONLY admissible source for
   * `active_in_consumer`. `null` means the caller did not perform the read at
   * all; combined with `consumerActivationLookupFailed` it distinguishes
   * "not asked" from "asked and it failed".
   */
  consumerActivation: ConsumerActivationRead | null
  /** True when `readConsumerActivation` threw. Renders `'unavailable'`, never `'unknown'`. */
  consumerActivationLookupFailed: boolean
}

export interface LifecycleTrace {
  stages: LifecycleStage[]
  versionDrift: VersionDriftReport
}

function resolveVersionDrift(
  versions: CopilotVersion[],
  delivery: DeliveryEvent | null,
  lastTelemetry: LifecycleTraceInput['lastTelemetry'],
  telemetryLookupFailed: boolean
): VersionDriftReport {
  const versionsById = new Map(versions.map((version) => [version.id, version]))
  const lastDeliveredVersionId = delivery?.versionId ?? null
  const lastDeliveredVersionLabel =
    lastDeliveredVersionId === null ? null : (versionsById.get(lastDeliveredVersionId)?.label ?? null)

  if (telemetryLookupFailed) {
    return {
      state: 'unknown',
      lastDeliveredVersionId,
      lastDeliveredVersionLabel,
      lastReportedVersion: null,
      versionsMatch: null,
      driftDetected: false,
      detail: 'The telemetry lookup failed — version drift cannot be assessed.',
    }
  }

  const lastReportedVersion = lastTelemetry?.agentVersion ?? null

  if (delivery === null) {
    return {
      state: 'unknown',
      lastDeliveredVersionId,
      lastDeliveredVersionLabel,
      lastReportedVersion,
      versionsMatch: null,
      driftDetected: false,
      detail: 'This agent has never been delivered — no delivered version to compare against.',
    }
  }

  if (lastDeliveredVersionId === null) {
    return {
      state: 'unknown',
      lastDeliveredVersionId,
      lastDeliveredVersionLabel,
      lastReportedVersion,
      versionsMatch: null,
      driftDetected: false,
      detail: 'The latest delivery row has no version id — delivered version is unknown and cannot be compared.',
    }
  }

  if (lastReportedVersion === null) {
    return {
      state: 'unknown',
      lastDeliveredVersionId,
      lastDeliveredVersionLabel,
      lastReportedVersion,
      versionsMatch: null,
      driftDetected: false,
      detail: 'No self-reported version has arrived in telemetry yet — no reported version to compare against.',
    }
  }

  const matchesDeliveredVersionId = lastReportedVersion === lastDeliveredVersionId
  const matchesDeliveredLabel =
    lastDeliveredVersionLabel !== null && lastReportedVersion === lastDeliveredVersionLabel
  const versionsMatch = matchesDeliveredVersionId || matchesDeliveredLabel

  return {
    state: 'measured',
    lastDeliveredVersionId,
    lastDeliveredVersionLabel,
    lastReportedVersion,
    versionsMatch,
    driftDetected: !versionsMatch,
    detail: versionsMatch
      ? 'Delivered version and telemetry-reported version match exactly.'
      : 'Delivered version and telemetry-reported version differ (version drift detected).',
  }
}

/**
 * The `active_in_consumer` stage — built EXCLUSIVELY from the
 * `consumer-activation.ts` verdict.
 *
 * Note what this function does not receive: no `delivery`, no `currentVersion`,
 * no telemetry row. It cannot infer activation from any of them because it is
 * never handed them. That is deliberate — the parameter list IS the guarantee,
 * and `check:lifecycle-truth` rule 5 enforces that `reached` here reads only
 * from `activation.activeInConsumer`.
 *
 * Three outcomes, and `false` is not among them:
 *   'unavailable'  the read failed — we could not look
 *   true           an authenticated consumer proved a RECENT run
 *   'unknown'      everything else, including stale proof
 */
function resolveConsumerStage(
  activation: ConsumerActivationRead | null,
  lookupFailed: boolean
): LifecycleStage {
  if (lookupFailed || activation === null) {
    return {
      key: 'active_in_consumer',
      label: 'Active in consumer',
      // NOT 'unknown': the read did not happen or did not succeed. Reporting an
      // outage as a calm absence is the exact lie this stage exists to avoid.
      reached: lookupFailed ? 'unavailable' : 'unknown',
      evidence: {
        source: 'consumer-activation.readConsumerActivation',
        state: lookupFailed ? 'unavailable' : 'unknown',
        detail: lookupFailed
          ? 'The consumer-activation read failed. This is UNAVAILABLE, not unknown — we could not look, ' +
            'so nothing about consumer activity was measured either way.'
          : 'No consumer-activation read was performed for this copilot, so activation was never assessed.',
      },
      consumer: {
        reason: lookupFailed
          ? 'The authenticated consumer-event read failed.'
          : 'No consumer-activation read was performed.',
        lastActivityAt: null,
        stale: false,
        observedInstallationCount: null,
        recencyWindowDays: null,
      },
    }
  }

  const verdict = activation.activeInConsumer

  return {
    key: 'active_in_consumer',
    label: 'Active in consumer',
    // The verdict is copied, never recomputed. `activeInConsumer` is typed
    // `true | 'unknown'`, so `false` cannot enter here even by accident.
    reached: verdict,
    evidence: {
      source: 'consumer-activation.readConsumerActivation (runtime_telemetry_events, installation_id not null)',
      state: verdict === true ? 'measured' : 'unknown',
      detail: activation.reason,
    },
    consumer: {
      reason: activation.reason,
      lastActivityAt: activation.lastActivityAt,
      stale: activation.staleEvidence,
      observedInstallationCount: activation.observedInstallationCount,
      recencyWindowDays: activation.recencyWindowDays,
    },
  }
}

export function buildLifecycleTrace(input: LifecycleTraceInput): LifecycleTrace {
  const { versions, currentVersion, delivery, lastTelemetry, telemetryLookupFailed, hasV2Draft, hasImprovementProposal } =
    input

  const hasAnyVersion = versions.length > 0
  const measured = currentVersion?.scoresEvidence === 'runs'
  const testPassRate = measured ? currentVersion?.scores.testPassRate ?? null : null
  const benchmarkScore = measured ? currentVersion?.scores.benchmarkScore ?? null : null

  const stages: LifecycleStage[] = [
    {
      key: 'draft',
      label: 'Draft',
      reached: hasAnyVersion,
      evidence: {
        source: 'copilot_versions',
        state: 'measured',
        detail: hasAnyVersion
          ? `${versions.length} version(s) persisted for this copilot.`
          : 'No version is persisted yet.',
      },
    },
    {
      key: 'tested',
      label: 'Tested',
      reached: measured && testPassRate !== null,
      evidence: {
        source: 'copilot_versions.scores (scoresEvidence: runs)',
        state: measured ? 'measured' : 'unknown',
        detail:
          measured && testPassRate !== null
            ? `Test pass rate measured from real runs: ${(testPassRate * 100).toFixed(1)}%.`
            : 'No run-backed test score is attached to the current version — the stored baseline is not a measurement.',
      },
    },
    {
      key: 'qualified',
      label: 'Qualified',
      reached: measured && benchmarkScore !== null,
      evidence: {
        source: 'copilot_versions.scores (scoresEvidence: runs)',
        state: measured ? 'measured' : 'unknown',
        detail:
          measured && benchmarkScore !== null
            ? `Benchmark score measured from real runs: ${benchmarkScore}.`
            : 'No run-backed benchmark score is attached to the current version.',
      },
    },
    {
      key: 'production',
      label: 'Production (Aigent)',
      reached: currentVersion?.stage === 'production',
      evidence: {
        source: 'copilot_versions.stage / copilots.production_version_id',
        state: 'measured',
        detail:
          currentVersion?.stage === 'production'
            ? 'The current version is pinned as production on Aigent.'
            : `The current version's stage is "${currentVersion?.stage ?? 'unknown'}" — not production.`,
      },
    },
    {
      key: 'delivered',
      label: 'Delivered',
      reached: delivery !== null,
      evidence: {
        source: 'agent_delivery_events',
        state: 'measured',
        detail:
          delivery === null
            ? 'No delivery row exists for this copilot — never pushed to a consumer repo.'
            : `Latest delivery: ${delivery.mode} to ${delivery.targetRepo} (status: ${delivery.status}). ` +
              'This proves a push happened — it does NOT prove the consumer merged or deployed it.',
      },
    },
    // Built by the dedicated resolver above, which is handed the activation
    // verdict and NOTHING else — no delivery, no stage, no telemetry row.
    resolveConsumerStage(input.consumerActivation, input.consumerActivationLookupFailed),
    {
      key: 'telemetry_received',
      label: 'Telemetry received',
      reached: telemetryLookupFailed ? 'unknown' : lastTelemetry !== null,
      evidence: {
        source: 'runtime_telemetry_events',
        state: telemetryLookupFailed ? 'unknown' : 'measured',
        detail: telemetryLookupFailed
          ? 'The telemetry lookup failed — this is unknown, not a measured absence.'
          : lastTelemetry === null
            ? 'No telemetry event has ever been received for this copilot.'
            : `Latest event received at ${lastTelemetry.receivedAt}. This proves a report arrived — it does ` +
              'NOT prove the agent is healthy (see telemetry-health.ts).',
      },
    },
    {
      key: 'improvement_proposed',
      label: 'Improvement proposed',
      reached: hasImprovementProposal,
      evidence: {
        source: 'improvement-loop artifacts',
        state: 'measured',
        detail: hasImprovementProposal
          ? 'An improvement analysis/proposal exists for this copilot.'
          : 'No improvement proposal has been recorded.',
      },
    },
    {
      key: 'v2_draft',
      label: 'V2 draft',
      reached: hasV2Draft,
      evidence: {
        source: 'copilot_versions (draft stage created from improvement loop)',
        state: 'measured',
        detail: hasV2Draft ? 'A V2 draft version exists.' : 'No V2 draft has been created.',
      },
    },
  ]

  return {
    stages,
    versionDrift: resolveVersionDrift(versions, delivery, lastTelemetry, telemetryLookupFailed),
  }
}
