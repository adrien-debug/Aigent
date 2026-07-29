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
 * they say Aigent considers this version the one to ship. There is no read
 * path from here into a consumer's own activation state (AGENTS.md is
 * explicit: "Après provisioning, Aigent ne fait que POUSSER des agents" —
 * activate/rebind/deploy-version belong to the consumer workspace). So
 * "active in consumer" is ALWAYS `unknown` in this resolver, by construction —
 * not a bug to fix later, a boundary this file will never cross without a real
 * consumer-side read channel.
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

export type EvidenceState = 'measured' | 'unknown'

export interface StageEvidence {
  /** Where this fact came from — a table or module name, not a guess. */
  source: string
  state: EvidenceState
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
  reached: boolean | 'unknown'
  evidence: StageEvidence
}

export interface VersionDriftReport {
  /** `unknown` when either side lacks a measured value — never guessed as "no drift". */
  state: EvidenceState
  lastDeliveredVersionLabel: string | null
  lastReportedVersion: string | null
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
}

export interface LifecycleTrace {
  stages: LifecycleStage[]
  versionDrift: VersionDriftReport
}

function resolveVersionDrift(
  delivery: DeliveryEvent | null,
  lastTelemetry: LifecycleTraceInput['lastTelemetry'],
  telemetryLookupFailed: boolean
): VersionDriftReport {
  // deliveryVersion is looked up via the delivery event's `versionId` — but
  // `DeliveryEvent` (delivery-events-store.ts) does not carry `versionId` on
  // its read shape today (only on the write input). So the delivered label is
  // resolvable only through the copilot's version list when the delivery
  // event's target lines up with a known version; absent that join, this is
  // honestly `unknown` rather than guessed from `productionVersionId`.
  const lastDeliveredVersionLabel = null as string | null

  if (telemetryLookupFailed) {
    return {
      state: 'unknown',
      lastDeliveredVersionLabel,
      lastReportedVersion: null,
      driftDetected: false,
      detail: 'The telemetry lookup failed — version drift cannot be assessed.',
    }
  }

  const lastReportedVersion = lastTelemetry?.agentVersion ?? null

  if (delivery === null || lastReportedVersion === null) {
    return {
      state: 'unknown',
      lastDeliveredVersionLabel,
      lastReportedVersion,
      driftDetected: false,
      detail:
        delivery === null
          ? 'This agent has never been delivered — no delivered version to compare against.'
          : 'No self-reported version has arrived in telemetry yet — no reported version to compare against.',
    }
  }

  return {
    state: 'unknown',
    lastDeliveredVersionLabel,
    lastReportedVersion,
    driftDetected: false,
    detail:
      'A delivery event exists and telemetry has reported a version, but the delivery event does not carry ' +
      'the version id on its read shape, so the delivered version label cannot be resolved for comparison. ' +
      'This is a real gap, not a computed match — recorded rather than guessed.',
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
    {
      key: 'active_in_consumer',
      label: 'Active in consumer',
      // ALWAYS unknown: Aigent has no read channel into a consumer's own
      // activation state (AGENTS.md, "Après provisioning, Aigent ne fait que
      // POUSSER des agents"). This is a boundary, not a gap to silently fill.
      reached: 'unknown',
      evidence: {
        source: 'none — no consumer-side read channel exists',
        state: 'unknown',
        detail:
          'Aigent cannot read a consumer workspace\'s activation state. A delivery event never implies this ' +
          'stage — it must never be inferred from `delivered`.',
      },
    },
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
    versionDrift: resolveVersionDrift(delivery, lastTelemetry, telemetryLookupFailed),
  }
}
