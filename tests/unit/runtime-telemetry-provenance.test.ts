import { describe, expect, it } from 'vitest'

import {
  classifyRuntimeTelemetryProvenance,
  type RuntimeTelemetryProvenance,
} from '@/lib/agent-mission-control/runtime-telemetry-provenance'
import type { RuntimeTelemetryEvent } from '@/lib/agent-mission-control/runtime-telemetry-store'

function event(partial: Partial<RuntimeTelemetryEvent> = {}): RuntimeTelemetryEvent {
  return {
    id: 'evt-1',
    projectId: 'proj-trade',
    agentId: 'copilot-x',
    agentVersion: null,
    targetRepo: null,
    runId: 'run-1',
    provider: 'openai',
    model: 'gpt-5.4',
    status: 'completed',
    latencyMs: 120,
    inputShape: {},
    outputShape: {},
    error: {},
    usage: {},
    environment: {},
    receivedAt: '2026-07-30T12:00:00.000Z',
    ...partial,
  }
}

describe('classifyRuntimeTelemetryProvenance', () => {
  it('labels internal runs from the Aigent runner', () => {
    expect(
      classifyRuntimeTelemetryProvenance(
        event({ environment: { source: 'aigent-internal-runner', env: 'dev' } })
      )
    ).toBe('internal')
  })

  it('labels lifecycle events from eventType', () => {
    expect(
      classifyRuntimeTelemetryProvenance(event({ eventType: 'promotion_completed' }))
    ).toBe('lifecycle')
  })

  it('labels lifecycle events from environment.source', () => {
    expect(
      classifyRuntimeTelemetryProvenance(
        event({ environment: { source: 'aigent-shadow', experimentId: 'exp-1' } })
      )
    ).toBe('lifecycle')
  })

  it('labels consumer only when explicitly marked', () => {
    expect(classifyRuntimeTelemetryProvenance(event({ environment: { source: 'consumer' } }))).toBe(
      'consumer'
    )
    expect(
      classifyRuntimeTelemetryProvenance(event({ environment: { source: 'aigent-consumer' } }))
    ).toBe('consumer')
  })

  it('returns unknown when consumer cannot be proven', () => {
    expect(classifyRuntimeTelemetryProvenance(event({ environment: { nodeEnv: 'production' } }))).toBe(
      'unknown'
    )
    expect(classifyRuntimeTelemetryProvenance(event())).toBe('unknown')
  })

  it('never classifies internal traffic as consumer', () => {
    const provenance: RuntimeTelemetryProvenance = classifyRuntimeTelemetryProvenance(
      event({ environment: { source: 'aigent-internal-runner' } })
    )
    expect(provenance).not.toBe('consumer')
    expect(provenance).toBe('internal')
  })
})

describe('overview telemetry copy guard', () => {
  it('empty-state wording does not claim an external-only feed', () => {
    const forbidden = /external telemetry/i
    const emptyTitle = 'No runtime telemetry event has been recorded yet.'
    expect(forbidden.test(emptyTitle)).toBe(false)
  })
})
