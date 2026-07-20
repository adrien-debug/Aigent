import { describe, expect, it } from 'vitest'

import { diagnoseTelemetryHealth, type TelemetryHealthInput } from '@/lib/agent-mission-control/telemetry-health'

const NOW = '2026-07-20T12:00:00.000Z'

function baseInput(overrides: Partial<TelemetryHealthInput> = {}): TelemetryHealthInput {
  return {
    ingestionTokenConfigured: true,
    agentsWithTelemetryDeclared: 3,
    lastEventReceivedAt: '2026-07-19T12:00:00.000Z',
    lastEventLookupFailed: false,
    now: NOW,
    muteThresholdDays: 7,
    ...overrides,
  }
}

describe('diagnoseTelemetryHealth', () => {
  it('reports not_configured when the Aigent-side token is absent, regardless of agent/event state', () => {
    const result = diagnoseTelemetryHealth(
      baseInput({ ingestionTokenConfigured: false, agentsWithTelemetryDeclared: 5, lastEventReceivedAt: null })
    )
    expect(result.status).toBe('not_configured')
    // Must not claim agents are inactive.
    expect(result.summary.toLowerCase()).not.toContain('agents are inactive')
    expect(result.summary).toContain('not currently receive')
  })

  it('never confuses "token absent" with "agents inactive": token-absent case is distinct status from loop_muted', () => {
    const tokenAbsent = diagnoseTelemetryHealth(baseInput({ ingestionTokenConfigured: false }))
    const muted = diagnoseTelemetryHealth(baseInput({ lastEventReceivedAt: null }))
    expect(tokenAbsent.status).toBe('not_configured')
    expect(muted.status).toBe('loop_muted')
    expect(tokenAbsent.status).not.toBe(muted.status)
  })

  it('reports unavailable when declared-agent count is unknown', () => {
    const result = diagnoseTelemetryHealth(baseInput({ agentsWithTelemetryDeclared: null }))
    expect(result.status).toBe('unavailable')
    expect(result.summary).toContain('cannot be determined')
  })

  it('reports unavailable when the last-event lookup itself failed', () => {
    const result = diagnoseTelemetryHealth(baseInput({ lastEventLookupFailed: true }))
    expect(result.status).toBe('unavailable')
  })

  it('reports incomplete_configuration when token is set but zero agents declare telemetry', () => {
    const result = diagnoseTelemetryHealth(baseInput({ agentsWithTelemetryDeclared: 0, lastEventReceivedAt: null }))
    expect(result.status).toBe('incomplete_configuration')
  })

  it('reports loop_muted when agents declare telemetry but none has ever arrived', () => {
    const result = diagnoseTelemetryHealth(baseInput({ lastEventReceivedAt: null }))
    expect(result.status).toBe('loop_muted')
    expect(result.daysSinceLastEvent).toBeNull()
    expect(result.summary).toContain('does NOT mean those agents are not running')
  })

  it('reports loop_muted when the last event is older than the mute threshold', () => {
    const result = diagnoseTelemetryHealth(
      baseInput({ lastEventReceivedAt: '2026-07-01T00:00:00.000Z', muteThresholdDays: 7 })
    )
    expect(result.status).toBe('loop_muted')
    expect(result.daysSinceLastEvent).toBeGreaterThan(7)
    expect(result.summary).toContain('does NOT mean the agents stopped running')
  })

  it('reports healthy when a recent event is within the threshold', () => {
    const result = diagnoseTelemetryHealth(baseInput({ lastEventReceivedAt: '2026-07-20T00:00:00.000Z' }))
    expect(result.status).toBe('healthy')
    expect(result.daysSinceLastEvent).toBeCloseTo(0.5, 1)
  })

  it('treats the threshold boundary as still healthy (strictly greater-than triggers mute)', () => {
    const result = diagnoseTelemetryHealth(
      baseInput({ lastEventReceivedAt: '2026-07-13T12:00:00.000Z', muteThresholdDays: 7 })
    )
    expect(result.daysSinceLastEvent).toBe(7)
    expect(result.status).toBe('healthy')
  })

  it('is a pure function: same input always yields the same output', () => {
    const input = baseInput()
    const a = diagnoseTelemetryHealth(input)
    const b = diagnoseTelemetryHealth(input)
    expect(a).toEqual(b)
  })

  it('passes through agentsWithTelemetryDeclared unchanged', () => {
    const result = diagnoseTelemetryHealth(baseInput({ agentsWithTelemetryDeclared: 42 }))
    expect(result.agentsWithTelemetryDeclared).toBe(42)
  })
})
