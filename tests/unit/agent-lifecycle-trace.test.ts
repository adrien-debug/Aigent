import { describe, expect, it } from 'vitest'

import { buildLifecycleTrace, type LifecycleTraceInput } from '@/lib/agent-mission-control/agent-lifecycle-trace'
import type { CopilotVersion } from '@/lib/agent-mission-control/types'
import type { DeliveryEvent } from '@/lib/agent-mission-control/delivery-events-store'

/**
 * Pure resolver — no I/O, no mocks needed. Each stage must expose its OWN
 * source and never collapse into a single derived status. See the module
 * header for the doctrine this enforces (delivered ≠ deployed, production
 * (Aigent) ≠ active (consumer), telemetry received ≠ healthy).
 */

function version(overrides: Partial<CopilotVersion> = {}): CopilotVersion {
  return {
    id: 'v1',
    copilotId: 'cop-1',
    label: 'v1.0.0',
    stage: 'draft',
    manifestId: 'man-1',
    model: 'gpt-5.4',
    modelProvider: 'openai',
    changelog: '',
    createdAt: '2026-07-01T00:00:00Z',
    createdBy: 'test',
    scores: { testPassRate: null, benchmarkScore: null, shadowAgreement: null, unsafeActionCount: null },
    scoresEvidence: 'none',
    ...overrides,
  } as CopilotVersion
}

function delivery(overrides: Partial<DeliveryEvent> = {}): DeliveryEvent {
  return {
    id: 'evt-1',
    versionId: 'v1',
    mode: 'pull_request',
    targetRepo: 'org/consumer-repo',
    targetBranch: 'main',
    deliveryBranch: 'aigent/deliver-cop-1',
    commitSha: null,
    commitUrl: null,
    prUrl: 'https://github.com/org/consumer-repo/pull/1',
    prNumber: 1,
    status: 'ready_for_manual_test',
    createdAt: '2026-07-29T10:00:00Z',
    ...overrides,
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

describe('buildLifecycleTrace — stage sourcing', () => {
  it('draft is reached only when a version is persisted, sourced from copilot_versions', () => {
    const none = buildLifecycleTrace(baseInput())
    expect(none.stages[0].reached).toBe(false)
    expect(none.stages[0].evidence.source).toBe('copilot_versions')

    const some = buildLifecycleTrace(baseInput({ versions: [version()] }))
    expect(some.stages[0].reached).toBe(true)
  })

  it('tested/qualified require scoresEvidence: runs — a stored zero baseline never counts as measured', () => {
    const unmeasured = buildLifecycleTrace(
      baseInput({ currentVersion: version({ scoresEvidence: 'none', scores: { testPassRate: 0, benchmarkScore: 0, shadowAgreement: null, unsafeActionCount: null } }) })
    )
    expect(unmeasured.stages[1].reached).toBe(false)
    expect(unmeasured.stages[1].evidence.state).toBe('unknown')

    const measured = buildLifecycleTrace(
      baseInput({
        currentVersion: version({
          scoresEvidence: 'runs',
          scores: { testPassRate: 0.9, benchmarkScore: 80, shadowAgreement: null, unsafeActionCount: 0 },
        }),
      })
    )
    expect(measured.stages[1].reached).toBe(true)
    expect(measured.stages[2].reached).toBe(true)
  })

  it('production stage reflects copilot_versions.stage exactly, not a guess', () => {
    const prod = buildLifecycleTrace(baseInput({ currentVersion: version({ stage: 'production' }) }))
    expect(prod.stages[3].reached).toBe(true)

    const draft = buildLifecycleTrace(baseInput({ currentVersion: version({ stage: 'draft' }) }))
    expect(draft.stages[3].reached).toBe(false)
  })

  it('delivered ≠ deployed: reaching "delivered" never implies "active in consumer"', () => {
    const result = buildLifecycleTrace(baseInput({ delivery: delivery() }))
    const delivered = result.stages.find((s) => s.key === 'delivered')!
    const activeInConsumer = result.stages.find((s) => s.key === 'active_in_consumer')!

    expect(delivered.reached).toBe(true)
    expect(delivered.evidence.detail.toLowerCase()).toContain('does not prove')

    // ALWAYS unknown, regardless of delivery — this is the doctrine boundary.
    expect(activeInConsumer.reached).toBe('unknown')
    expect(activeInConsumer.evidence.state).toBe('unknown')
  })

  it('"active in consumer" stays unknown even with a successful delivery — never inferred', () => {
    const result = buildLifecycleTrace(baseInput({ delivery: delivery({ status: 'delivered' }) }))
    const activeInConsumer = result.stages.find((s) => s.key === 'active_in_consumer')!
    expect(activeInConsumer.reached).toBe('unknown')
  })

  it('telemetry received ≠ healthy: the stage never asserts health', () => {
    const result = buildLifecycleTrace(
      baseInput({ lastTelemetry: { agentVersion: 'v1.0.0', receivedAt: '2026-07-29T12:00:00Z' } })
    )
    const stage = result.stages.find((s) => s.key === 'telemetry_received')!
    expect(stage.reached).toBe(true)
    expect(stage.evidence.detail.toLowerCase()).toContain('not prove')
    expect(stage.evidence.detail.toLowerCase()).not.toContain('healthy agent')
  })

  it('a failed telemetry lookup is unknown, never a false zero (no events)', () => {
    const failed = buildLifecycleTrace(baseInput({ telemetryLookupFailed: true }))
    const stage = failed.stages.find((s) => s.key === 'telemetry_received')!
    expect(stage.reached).toBe('unknown')
    expect(stage.evidence.state).toBe('unknown')

    const genuinelyNone = buildLifecycleTrace(baseInput({ telemetryLookupFailed: false, lastTelemetry: null }))
    const stage2 = genuinelyNone.stages.find((s) => s.key === 'telemetry_received')!
    expect(stage2.reached).toBe(false) // measured absence, not unknown
    expect(stage2.evidence.state).toBe('measured')
  })

  it('improvement_proposed and v2_draft each read their own flag, independently', () => {
    const result = buildLifecycleTrace(baseInput({ hasImprovementProposal: true, hasV2Draft: false }))
    expect(result.stages.find((s) => s.key === 'improvement_proposed')!.reached).toBe(true)
    expect(result.stages.find((s) => s.key === 'v2_draft')!.reached).toBe(false)
  })
})

describe('buildLifecycleTrace — version drift', () => {
  it('is unknown when the agent was never delivered', () => {
    const result = buildLifecycleTrace(baseInput({ delivery: null }))
    expect(result.versionDrift.state).toBe('unknown')
    expect(result.versionDrift.driftDetected).toBe(false)
    expect(result.versionDrift.versionsMatch).toBeNull()
  })

  it('is unknown when the latest delivery has no version id', () => {
    const result = buildLifecycleTrace(
      baseInput({
        versions: [version({ id: 'v1', label: 'v1.0.0' })],
        delivery: delivery({ versionId: null }),
        lastTelemetry: { agentVersion: 'v1.0.0', receivedAt: '2026-07-29T12:00:00Z' },
      })
    )
    expect(result.versionDrift.state).toBe('unknown')
    expect(result.versionDrift.driftDetected).toBe(false)
    expect(result.versionDrift.versionsMatch).toBeNull()
  })

  it('is unknown when no version has been reported by telemetry', () => {
    const result = buildLifecycleTrace(baseInput({ delivery: delivery(), lastTelemetry: null }))
    expect(result.versionDrift.state).toBe('unknown')
    expect(result.versionDrift.versionsMatch).toBeNull()
  })

  it('is unknown when the telemetry lookup itself failed', () => {
    const result = buildLifecycleTrace(
      baseInput({
        delivery: delivery(),
        lastTelemetry: { agentVersion: 'v1.0.0', receivedAt: '2026-07-29T12:00:00Z' },
        telemetryLookupFailed: true,
      })
    )
    expect(result.versionDrift.state).toBe('unknown')
    expect(result.versionDrift.detail).toContain('lookup failed')
    expect(result.versionDrift.versionsMatch).toBeNull()
  })

  it('reports match when telemetry reports the delivered version label exactly', () => {
    const result = buildLifecycleTrace(
      baseInput({
        versions: [version({ id: 'v1', label: 'v1.0.0' })],
        delivery: delivery({ versionId: 'v1' }),
        lastTelemetry: { agentVersion: 'v1.0.0', receivedAt: '2026-07-29T12:00:00Z' },
      })
    )
    expect(result.versionDrift.state).toBe('measured')
    expect(result.versionDrift.lastDeliveredVersionId).toBe('v1')
    expect(result.versionDrift.lastDeliveredVersionLabel).toBe('v1.0.0')
    expect(result.versionDrift.lastReportedVersion).toBe('v1.0.0')
    expect(result.versionDrift.versionsMatch).toBe(true)
    expect(result.versionDrift.driftDetected).toBe(false)
  })

  it('reports drift when telemetry reports a different version', () => {
    const result = buildLifecycleTrace(
      baseInput({
        versions: [version({ id: 'v1', label: 'v1.0.0' })],
        delivery: delivery({ versionId: 'v1' }),
        lastTelemetry: { agentVersion: 'v2.0.0', receivedAt: '2026-07-29T12:00:00Z' },
      })
    )
    expect(result.versionDrift.state).toBe('measured')
    expect(result.versionDrift.lastDeliveredVersionId).toBe('v1')
    expect(result.versionDrift.lastDeliveredVersionLabel).toBe('v1.0.0')
    expect(result.versionDrift.lastReportedVersion).toBe('v2.0.0')
    expect(result.versionDrift.versionsMatch).toBe(false)
    expect(result.versionDrift.driftDetected).toBe(true)
  })

  it('still computes drift from delivered version id when local versions list cannot resolve the label', () => {
    const result = buildLifecycleTrace(
      baseInput({
        versions: [],
        delivery: delivery({ versionId: 'v1' }),
        lastTelemetry: { agentVersion: 'v1', receivedAt: '2026-07-29T12:00:00Z' },
      })
    )
    expect(result.versionDrift.state).toBe('measured')
    expect(result.versionDrift.lastDeliveredVersionId).toBe('v1')
    expect(result.versionDrift.lastDeliveredVersionLabel).toBeNull()
    expect(result.versionDrift.versionsMatch).toBe(true)
    expect(result.versionDrift.driftDetected).toBe(false)
  })
})
