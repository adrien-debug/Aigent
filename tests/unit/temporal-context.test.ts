import { describe, expect, it } from 'vitest'

import {
  TEMPORAL_CONTEXT_MARKER,
  buildTemporalContext,
  withTemporalContext,
} from '@/lib/agent-mission-control/temporal-context'

const FIXED = new Date('2026-05-14T09:30:00.000Z') // a Thursday

describe('buildTemporalContext', () => {
  it('is deterministic for a fixed date', () => {
    expect(buildTemporalContext(FIXED)).toBe(buildTemporalContext(new Date(FIXED.getTime())))
  })

  it('states the real date facts (the November-in-May bug)', () => {
    const block = buildTemporalContext(FIXED)
    expect(block).toContain('2026-05-14')
    expect(block).toContain('Thursday')
    expect(block).toContain('May 14, 2026')
    expect(block).toContain('Q2 2026')
    expect(block).not.toContain('November')
  })

  it('carries the never-assume instruction', () => {
    expect(buildTemporalContext(FIXED)).toContain('Never assume a different date')
  })

  it('is domain-neutral (no commercial calendar)', () => {
    const block = buildTemporalContext(FIXED).toLowerCase()
    for (const word of ['black friday', 'noël', 'soldes', 'christmas']) {
      expect(block).not.toContain(word)
    }
  })

  it('throws on an invalid date rather than emitting NaN facts', () => {
    expect(() => buildTemporalContext(new Date('nope'))).toThrow(/invalid reference date/)
  })
})

describe('withTemporalContext', () => {
  it('prepends the block to the system prompt', () => {
    const out = withTemporalContext('You are a copilot.', FIXED)
    expect(out.startsWith(TEMPORAL_CONTEXT_MARKER)).toBe(true)
    expect(out).toContain('You are a copilot.')
  })

  it('never injects twice', () => {
    const once = withTemporalContext('You are a copilot.', FIXED)
    const twice = withTemporalContext(once, new Date('2026-11-02T00:00:00.000Z'))
    expect(twice).toBe(once)
    expect(twice.split(TEMPORAL_CONTEXT_MARKER)).toHaveLength(2)
  })
})
