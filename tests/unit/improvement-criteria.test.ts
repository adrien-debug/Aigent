import { describe, expect, it } from 'vitest'

import {
  hasRuntimeTelemetryBelowImproveTarget,
  IMPROVEMENT_MAX_TELEMETRY_FAILURE_RATE,
  IMPROVEMENT_MIN_TELEMETRY_TERMINAL_RUNS,
} from '@/lib/agent-mission-control/improvement-criteria'

describe('hasRuntimeTelemetryBelowImproveTarget', () => {
  it('is false when telemetry is absent (unavailable, never fabricated)', () => {
    expect(hasRuntimeTelemetryBelowImproveTarget(undefined)).toBe(false)
  })

  it('is false below the minimum terminal-run sample, even with a bad rate', () => {
    expect(
      hasRuntimeTelemetryBelowImproveTarget({
        completedRuns: 1,
        failedRuns: 1,
        failureRate: 0.9,
      })
    ).toBe(false)
    expect(1 + 1).toBeLessThan(IMPROVEMENT_MIN_TELEMETRY_TERMINAL_RUNS)
  })

  it('is false when failureRate is null (unmeasured) even with enough runs', () => {
    expect(
      hasRuntimeTelemetryBelowImproveTarget({
        completedRuns: 10,
        failedRuns: 0,
        failureRate: null,
      })
    ).toBe(false)
  })

  it('is false at/under the target failure rate with enough runs', () => {
    expect(
      hasRuntimeTelemetryBelowImproveTarget({
        completedRuns: 9,
        failedRuns: 1,
        failureRate: IMPROVEMENT_MAX_TELEMETRY_FAILURE_RATE,
      })
    ).toBe(false)
  })

  it('is true above the target failure rate with enough terminal runs', () => {
    expect(
      hasRuntimeTelemetryBelowImproveTarget({
        completedRuns: 6,
        failedRuns: 4,
        failureRate: 0.4,
      })
    ).toBe(true)
  })
})
