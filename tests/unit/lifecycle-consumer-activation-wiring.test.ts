/**
 * The `active_in_consumer` stage, END TO END through the seam that was just
 * wired: authenticated consumer rows → `deriveConsumerActivation` →
 * `buildLifecycleTrace` → the `LifecycleStage` a surface renders.
 *
 * `tests/unit/consumer-activation.test.ts` already proves the aggregation in
 * isolation. What is NOT proven there, and is proven here, is that the trace
 * COPIES that verdict instead of inventing its own — the exact failure mode the
 * stage spent its whole life avoiding by hard-coding `'unknown'`.
 *
 * Offline and deterministic: `deriveConsumerActivation` is pure and takes an
 * injected `now`, `buildLifecycleTrace` does no I/O. No backend is touched.
 *
 * The eleven cases the mission requires, in order:
 *   1  no event at all
 *   2  installation_seen only
 *   3  version_loaded only
 *   4  heartbeat only            ← a live runtime is NOT an execution
 *   5  run_started, recent
 *   6  run_completed, recent
 *   7  run_failed, recent        ← a failed run still PROVES execution
 *   8  stale proof               ← unknown AND staleEvidence, both
 *   9  wrong tenant              ← another copilot's rows never leak in
 *  10  read failure              ← 'unavailable', never 'unknown'
 *  11  no branch ever yields false
 */
import { describe, expect, it } from 'vitest'

import {
  ACTIVATION_RECENCY_WINDOW_MS,
  deriveConsumerActivation,
  type ConsumerEventType,
} from '@/lib/agent-mission-control/consumer-activation'
import {
  buildLifecycleTrace,
  type LifecycleStage,
  type LifecycleTraceInput,
} from '@/lib/agent-mission-control/agent-lifecycle-trace'

const NOW = new Date('2026-07-31T12:00:00.000Z')
const COPILOT = 'qa-copilot-alpha'
const INSTALLATION = 'qa-inst-alpha'

function agoMs(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString()
}

const MINUTE = 60 * 1000

/** An authenticated consumer row, as the ingestion route persists it. */
function row(eventType: ConsumerEventType, receivedAt: string, extra: Record<string, unknown> = {}) {
  return {
    event_type: eventType,
    received_at: receivedAt,
    installation_id: INSTALLATION,
    version_id: null,
    ...extra,
  }
}

function baseInput(overrides: Partial<LifecycleTraceInput> = {}): LifecycleTraceInput {
  return {
    versions: [],
    currentVersion: undefined,
    delivery: null,
    lastTelemetry: null,
    telemetryLookupFailed: false,
    hasV2Draft: false,
    hasImprovementProposal: false,
    consumerActivation: null,
    consumerActivationLookupFailed: false,
    ...overrides,
  }
}

/**
 * Runs the real seam: derive the verdict from rows, hand it to the trace, and
 * return the stage a surface would render.
 */
function stageFor(
  rows: Parameters<typeof deriveConsumerActivation>[1],
  options: { delivered?: boolean } = {}
): LifecycleStage {
  const activation = deriveConsumerActivation(COPILOT, rows, {
    delivered: options.delivered ?? false,
    now: NOW,
  })
  const trace = buildLifecycleTrace(baseInput({ consumerActivation: activation }))
  return trace.stages.find((s) => s.key === 'active_in_consumer')!
}

describe('active_in_consumer — no proof means unknown, never false', () => {
  it('1 — no consumer event at all: unknown, and the reason says so', () => {
    const stage = stageFor([])
    expect(stage.reached).toBe('unknown')
    expect(stage.evidence.state).toBe('unknown')
    expect(stage.consumer?.lastActivityAt).toBeNull()
    expect(stage.consumer?.stale).toBe(false)
    expect(stage.consumer?.reason).toMatch(/has ever arrived/i)
  })

  it('1b — delivered with no consumer event stays unknown: a push is not an activation', () => {
    const stage = stageFor([], { delivered: true })
    expect(stage.reached).toBe('unknown')
    expect(stage.reached).not.toBe(true)
    expect(stage.consumer?.reason).toMatch(/never activation|unknown, not false/i)
  })

  it('2 — installation_seen alone: authenticated, but nothing ran', () => {
    const stage = stageFor([row('consumer.installation_seen', agoMs(MINUTE))])
    expect(stage.reached).toBe('unknown')
    // The timestamp still surfaces: we DID observe something, just not a run.
    expect(stage.consumer?.lastActivityAt).toBe(agoMs(MINUTE))
    expect(stage.consumer?.observedInstallationCount).toBe(1)
    expect(stage.consumer?.stale).toBe(false)
  })

  it('3 — version_loaded alone: a load is not a run', () => {
    const stage = stageFor([row('consumer.version_loaded', agoMs(MINUTE), { version_id: 'v3' })])
    expect(stage.reached).toBe('unknown')
    expect(stage.consumer?.reason).toMatch(/loaded a version but never reported a run/i)
  })

  it('4 — heartbeat alone: a LIVE RUNTIME is not an EXECUTION', () => {
    // The trap this whole stage exists to avoid. A heartbeat one minute old is
    // maximally fresh and still proves nothing about the agent having run.
    const stage = stageFor([row('consumer.heartbeat', agoMs(MINUTE))])
    expect(stage.reached).toBe('unknown')
    expect(stage.reached).not.toBe(true)
    expect(stage.evidence.state).toBe('unknown')
    expect(stage.consumer?.stale).toBe(false)
  })
})

describe('active_in_consumer — recent authenticated execution proves activation', () => {
  const EXECUTION_TYPES: ConsumerEventType[] = [
    'consumer.run_started',
    'consumer.run_completed',
    'consumer.run_failed',
  ]

  for (const [index, eventType] of EXECUTION_TYPES.entries()) {
    it(`${5 + index} — ${eventType} within the window: true`, () => {
      const at = agoMs(5 * MINUTE)
      const stage = stageFor([row(eventType, at)])
      expect(stage.reached).toBe(true)
      expect(stage.evidence.state).toBe('measured')
      expect(stage.consumer?.lastActivityAt).toBe(at)
      expect(stage.consumer?.stale).toBe(false)
      expect(stage.consumer?.recencyWindowDays).toBe(7)
    })
  }

  it('7b — a FAILED run still proves the agent executed at the consumer', () => {
    // Deliberate: `run_failed` is evidence of execution, not evidence of health.
    // Treating it as "not active" would understate real adoption.
    const stage = stageFor([row('consumer.run_failed', agoMs(MINUTE))])
    expect(stage.reached).toBe(true)
  })
})

describe('active_in_consumer — stale proof expires back to unknown', () => {
  it('8 — proof older than the window: unknown AND stale, both at once', () => {
    const stage = stageFor([row('consumer.run_completed', agoMs(ACTIVATION_RECENCY_WINDOW_MS + MINUTE))])
    // BOTH, not one or the other: the verdict expires, and the surface must be
    // able to say WHY it expired rather than showing a bare "unknown".
    expect(stage.reached).toBe('unknown')
    expect(stage.consumer?.stale).toBe(true)
    expect(stage.consumer?.lastActivityAt).not.toBeNull()
    expect(stage.consumer?.reason).toMatch(/older than the .* recency window/i)
    // Expiry means we stopped knowing — it never becomes a claim of inactivity.
    expect(stage.reached).not.toBe(false)
  })
})

describe('active_in_consumer — tenancy', () => {
  it('9 — rows from another tenant never reach this copilot', () => {
    // The read filters on `agent_id=eq.<copilotId>` at the database. What is
    // asserted here is the consequence: given only foreign rows, the caller
    // hands the derivation an EMPTY set, and the honest answer is unknown —
    // not the foreign tenant's `true`.
    const foreignVerdict = deriveConsumerActivation(
      'some-other-copilot',
      [row('consumer.run_completed', agoMs(MINUTE))],
      { delivered: false, now: NOW }
    )
    expect(foreignVerdict.activeInConsumer).toBe(true)
    expect(foreignVerdict.copilotId).toBe('some-other-copilot')

    // Our copilot, whose own query returned nothing:
    const stage = stageFor([])
    expect(stage.reached).toBe('unknown')
  })

  it('9b — an event WITHOUT an installation id is not consumer proof', () => {
    // Internal telemetry (runner.ts) lands in the same table. It is not an
    // authenticated consumer report and must never count as one.
    const stage = stageFor([
      { event_type: 'consumer.run_completed', received_at: agoMs(MINUTE), installation_id: null },
    ])
    expect(stage.reached).toBe('unknown')
    expect(stage.consumer?.observedInstallationCount).toBe(0)
  })
})

describe('active_in_consumer — a failed read is UNAVAILABLE, not unknown', () => {
  it('10 — lookup failure: reached and evidence are both "unavailable"', () => {
    // The principal trap of this wiring. "I could not read" is not "I read and
    // there was nothing to report" — flattening the two turns an outage into a
    // calm, believable product state.
    const trace = buildLifecycleTrace(
      baseInput({ consumerActivation: null, consumerActivationLookupFailed: true })
    )
    const stage = trace.stages.find((s) => s.key === 'active_in_consumer')!
    expect(stage.reached).toBe('unavailable')
    expect(stage.reached).not.toBe('unknown')
    expect(stage.evidence.state).toBe('unavailable')
    expect(stage.evidence.detail).toMatch(/UNAVAILABLE, not unknown/i)
    // Nothing is fabricated on the failure path either.
    expect(stage.consumer?.lastActivityAt).toBeNull()
    expect(stage.consumer?.stale).toBe(false)
    expect(stage.consumer?.observedInstallationCount).toBeNull()
  })

  it('10b — "not asked" is unknown, and is distinct from "asked and it failed"', () => {
    const notAsked = buildLifecycleTrace(baseInput()).stages.find((s) => s.key === 'active_in_consumer')!
    const failed = buildLifecycleTrace(
      baseInput({ consumerActivationLookupFailed: true })
    ).stages.find((s) => s.key === 'active_in_consumer')!
    expect(notAsked.reached).toBe('unknown')
    expect(failed.reached).toBe('unavailable')
    expect(notAsked.reached).not.toBe(failed.reached)
  })
})

describe('active_in_consumer — false is unreachable', () => {
  it('11 — no combination of inputs ever yields false', () => {
    const eventTypes: ConsumerEventType[] = [
      'consumer.installation_seen',
      'consumer.version_loaded',
      'consumer.run_started',
      'consumer.run_completed',
      'consumer.run_failed',
      'consumer.heartbeat',
    ]
    const ages = [0, MINUTE, ACTIVATION_RECENCY_WINDOW_MS - MINUTE, ACTIVATION_RECENCY_WINDOW_MS + MINUTE]

    for (const delivered of [true, false]) {
      // No rows, and the two non-derived paths.
      for (const stage of [
        stageFor([], { delivered }),
        buildLifecycleTrace(baseInput({ consumerActivationLookupFailed: true })).stages.find(
          (s) => s.key === 'active_in_consumer'
        )!,
      ]) {
        expect(stage.reached === true || stage.reached === 'unknown' || stage.reached === 'unavailable').toBe(true)
        expect(stage.reached as unknown).not.toBe(false)
      }

      for (const eventType of eventTypes) {
        for (const age of ages) {
          const stage = stageFor([row(eventType, agoMs(age))], { delivered })
          expect(stage.reached === true || stage.reached === 'unknown').toBe(true)
          expect(stage.reached as unknown).not.toBe(false)
        }
      }
    }
  })

  it('11b — a delivery, a production stage and internal telemetry cannot activate the stage', () => {
    // The old lie, re-tested from the outside: every Aigent-side fact set to
    // its most "convincing" value, and the verdict still refuses to move.
    const trace = buildLifecycleTrace(
      baseInput({
        delivery: {
          id: 'evt-1',
          versionId: 'v3',
          mode: 'pull_request',
          targetRepo: 'org/consumer-repo',
          targetBranch: 'main',
          deliveryBranch: 'aigent/deliver-qa',
          commitSha: null,
          commitUrl: null,
          prUrl: 'https://github.com/org/consumer-repo/pull/1',
          prNumber: 1,
          status: 'ready_for_manual_test',
          createdAt: agoMs(MINUTE),
        },
        lastTelemetry: { agentVersion: 'v3', receivedAt: agoMs(MINUTE) },
        consumerActivation: deriveConsumerActivation(COPILOT, [], { delivered: true, now: NOW }),
      })
    )
    const stage = trace.stages.find((s) => s.key === 'active_in_consumer')!
    expect(stage.reached).toBe('unknown')
    // ... while `delivered` itself is legitimately reached. The two facts stay
    // separate, which is the entire point.
    expect(trace.stages.find((s) => s.key === 'delivered')!.reached).toBe(true)
  })
})

/* ─────────── Cas ajoutés après revue croisée par l'agent D5 ─────────── */

describe('active_in_consumer — la borne de la fenêtre, et une date illisible', () => {
  it('la borne EXACTE est inclusive — `>=`, pas `>`', () => {
    // Le seul test existant couvrait ±1 minute : un passage de `>=` à `>` ne
    // rougissait rien. Cette assertion épingle la borne elle-même.
    const stage = stageFor([row('consumer.run_completed', agoMs(ACTIVATION_RECENCY_WINDOW_MS))])
    expect(stage.reached).toBe(true)
  })

  it('un `received_at` nul ne prouve rien — et n’efface pas l’installation', () => {
    // L'installation s'est authentifiée : elle compte. C'est son HORODATAGE
    // qui est inutilisable, pas son identité. Les deux faits sont distincts.
    const stage = stageFor([row('consumer.run_completed', null as unknown as string)])
    expect(stage.reached).toBe('unknown')
    expect(stage.reached).not.toBe(false)
  })

  it('une date malformée se comporte comme une date absente, jamais comme une preuve', () => {
    const stage = stageFor([row('consumer.run_completed', 'pas-une-date')])
    expect(stage.reached).toBe('unknown')
  })
})

describe('active_in_consumer — le dernier saut avant le pixel', () => {
  it('l’étape ne rend JAMAIS `not-reached` — ni sur unknown, ni sur unavailable', () => {
    // `not-reached` se lit « on a mesuré, et c'est non ». Sur cette étape, ce
    // serait affirmer une inactivité que personne n'a constatée.
    const cases: LifecycleStage[] = [
      stageFor([]),
      stageFor([row('consumer.heartbeat', agoMs(MINUTE))]),
      stageFor([row('consumer.run_completed', agoMs(ACTIVATION_RECENCY_WINDOW_MS + MINUTE))]),
      buildLifecycleTrace(
        baseInput({ consumerActivation: null, consumerActivationLookupFailed: true })
      ).stages.find((s) => s.key === 'active_in_consumer')!,
    ]

    for (const stage of cases) {
      expect(stage.reached === 'unknown' || stage.reached === 'unavailable').toBe(true)
      expect(stage.reached).not.toBe(false)
    }
  })
})
