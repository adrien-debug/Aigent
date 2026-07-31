/**
 * Unit tests for the consumer activation read
 * (src/lib/agent-mission-control/consumer-activation.ts).
 *
 * Pure and offline — deriveConsumerActivation does no I/O, so the recency rule
 * is tested directly with an injected `now`.
 *
 * The central guarantee under test: `activeInConsumer` is `true` ONLY on recent
 * authenticated execution proof, `'unknown'` in every other case, and NEVER
 * `false`.
 */
import { describe, expect, it } from 'vitest'

import {
  ACTIVATION_RECENCY_WINDOW_MS,
  deriveConsumerActivation,
} from '@/lib/agent-mission-control/consumer-activation'

const NOW = new Date('2026-07-31T12:00:00.000Z')

function agoMs(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString()
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('deriveConsumerActivation — never observed', () => {
  it('1 — no rows at all: stage never_observed, activeInConsumer unknown', () => {
    const read = deriveConsumerActivation('cop-1', [], { delivered: false, now: NOW })
    expect(read.stage).toBe('never_observed')
    expect(read.activeInConsumer).toBe('unknown')
    expect(read.lastActivityAt).toBeNull()
    expect(read.observedInstallationCount).toBe(0)
  })

  it('2 — delivered but never observed stays unknown, never false', () => {
    const read = deriveConsumerActivation('cop-1', [], { delivered: true, now: NOW })
    expect(read.delivered).toBe(true)
    expect(read.stage).toBe('never_observed')
    // A push proves delivery, never activation.
    expect(read.activeInConsumer).toBe('unknown')
    expect(read.activeInConsumer).not.toBe(false)
  })

  it('3 — rows lacking installation_id prove nothing (internal emitters ignored)', () => {
    const read = deriveConsumerActivation(
      'cop-1',
      [
        { event_type: 'consumer.run_completed', received_at: agoMs(HOUR), installation_id: null },
        { event_type: 'consumer.run_completed', received_at: agoMs(HOUR) },
      ],
      { delivered: true, now: NOW }
    )
    expect(read.stage).toBe('never_observed')
    expect(read.activeInConsumer).toBe('unknown')
  })
})

describe('deriveConsumerActivation — observation stages', () => {
  it('4 — installation_seen only: observed, but execution unproven', () => {
    const read = deriveConsumerActivation(
      'cop-1',
      [{ event_type: 'consumer.installation_seen', received_at: agoMs(HOUR), installation_id: 'inst-1' }],
      { delivered: true, now: NOW }
    )
    expect(read.stage).toBe('installation_observed')
    expect(read.activeInConsumer).toBe('unknown')
    expect(read.observedInstallationCount).toBe(1)
  })

  it('5 — heartbeat proves the runtime is alive, NOT that the agent ran', () => {
    const read = deriveConsumerActivation(
      'cop-1',
      [{ event_type: 'consumer.heartbeat', received_at: agoMs(HOUR), installation_id: 'inst-1' }],
      { delivered: true, now: NOW }
    )
    expect(read.stage).toBe('installation_observed')
    expect(read.activeInConsumer).toBe('unknown')
  })

  it('6 — version_loaded records the version and stays unknown without a run', () => {
    const read = deriveConsumerActivation(
      'cop-1',
      [
        {
          event_type: 'consumer.version_loaded',
          received_at: agoMs(HOUR),
          installation_id: 'inst-1',
          version_id: 'v-7',
        },
      ],
      { delivered: true, now: NOW }
    )
    expect(read.stage).toBe('version_loaded')
    expect(read.lastVersionLoaded).toBe('v-7')
    expect(read.activeInConsumer).toBe('unknown')
  })

  it('7 — counts distinct installations', () => {
    const read = deriveConsumerActivation(
      'cop-1',
      [
        { event_type: 'consumer.heartbeat', received_at: agoMs(HOUR), installation_id: 'inst-1' },
        { event_type: 'consumer.heartbeat', received_at: agoMs(HOUR), installation_id: 'inst-2' },
        { event_type: 'consumer.heartbeat', received_at: agoMs(HOUR), installation_id: 'inst-1' },
      ],
      { delivered: true, now: NOW }
    )
    expect(read.observedInstallationCount).toBe(2)
  })
})

describe('deriveConsumerActivation — activation requires RECENT execution proof', () => {
  for (const eventType of ['consumer.run_started', 'consumer.run_completed', 'consumer.run_failed'] as const) {
    it(`8 — ${eventType} within the window proves activation`, () => {
      const read = deriveConsumerActivation(
        'cop-1',
        [{ event_type: eventType, received_at: agoMs(HOUR), installation_id: 'inst-1' }],
        { delivered: true, now: NOW }
      )
      expect(read.stage).toBe('execution_observed')
      expect(read.activeInConsumer).toBe(true)
      expect(read.staleEvidence).toBe(false)
    })
  }

  it('9 — execution just INSIDE the window still proves activation', () => {
    const read = deriveConsumerActivation(
      'cop-1',
      [
        {
          event_type: 'consumer.run_completed',
          received_at: agoMs(ACTIVATION_RECENCY_WINDOW_MS - HOUR),
          installation_id: 'inst-1',
        },
      ],
      { delivered: true, now: NOW }
    )
    expect(read.activeInConsumer).toBe(true)
  })

  it('10 — execution PAST the window expires back to unknown, never false', () => {
    const read = deriveConsumerActivation(
      'cop-1',
      [
        {
          event_type: 'consumer.run_completed',
          received_at: agoMs(ACTIVATION_RECENCY_WINDOW_MS + DAY),
          installation_id: 'inst-1',
        },
      ],
      { delivered: true, now: NOW }
    )
    expect(read.activeInConsumer).toBe('unknown')
    expect(read.activeInConsumer).not.toBe(false)
    expect(read.staleEvidence).toBe(true)
    // The stage still records what was observed — the history is not erased.
    expect(read.stage).toBe('execution_observed')
  })

  it('11 — a recent heartbeat does NOT rescue a stale run', () => {
    const read = deriveConsumerActivation(
      'cop-1',
      [
        {
          event_type: 'consumer.run_completed',
          received_at: agoMs(ACTIVATION_RECENCY_WINDOW_MS + DAY),
          installation_id: 'inst-1',
        },
        { event_type: 'consumer.heartbeat', received_at: agoMs(HOUR), installation_id: 'inst-1' },
      ],
      { delivered: true, now: NOW }
    )
    // Liveness is not execution.
    expect(read.activeInConsumer).toBe('unknown')
    expect(read.staleEvidence).toBe(true)
  })

  it('12 — the recency window is reported so a verdict is never unexplained', () => {
    const read = deriveConsumerActivation('cop-1', [], { delivered: false, now: NOW })
    expect(read.recencyWindowMs).toBe(ACTIVATION_RECENCY_WINDOW_MS)
    expect(read.recencyWindowDays).toBe(7)
    expect(read.reason).toBeTruthy()
  })

  it('13 — activeInConsumer is NEVER the boolean false, across every scenario', () => {
    const scenarios = [
      [],
      [{ event_type: 'consumer.installation_seen', received_at: agoMs(HOUR), installation_id: 'i' }],
      [{ event_type: 'consumer.heartbeat', received_at: agoMs(500 * DAY), installation_id: 'i' }],
      [{ event_type: 'consumer.run_completed', received_at: agoMs(500 * DAY), installation_id: 'i' }],
      [{ event_type: 'consumer.run_completed', received_at: agoMs(HOUR), installation_id: 'i' }],
      [{ event_type: 'bogus', received_at: agoMs(HOUR), installation_id: 'i' }],
      [{ event_type: 'consumer.run_completed', received_at: 'not-a-date', installation_id: 'i' }],
    ]
    for (const rows of scenarios) {
      for (const delivered of [true, false]) {
        const read = deriveConsumerActivation('cop-1', rows, { delivered, now: NOW })
        expect(read.activeInConsumer === true || read.activeInConsumer === 'unknown').toBe(true)
        expect(read.activeInConsumer as unknown).not.toBe(false)
      }
    }
  })

  it('14 — an unparseable timestamp never counts as proof', () => {
    const read = deriveConsumerActivation(
      'cop-1',
      [{ event_type: 'consumer.run_completed', received_at: 'not-a-date', installation_id: 'inst-1' }],
      { delivered: true, now: NOW }
    )
    expect(read.activeInConsumer).toBe('unknown')
  })

  it('15 — an unrecognised event type is not execution proof', () => {
    const read = deriveConsumerActivation(
      'cop-1',
      [{ event_type: 'consumer.something_new', received_at: agoMs(HOUR), installation_id: 'inst-1' }],
      { delivered: true, now: NOW }
    )
    expect(read.activeInConsumer).toBe('unknown')
  })
})
