/**
 * AIGENT-FRONTEND-RESET-001 — KPI derivation.
 *
 * The invariants pinned here are the ones that stop the cockpit from lying:
 * a rate with no denominator is `null` (rendered "Not measured", never 0%),
 * and an unmeasurable cost is `null` (never summed as zero).
 */
import { describe, expect, it } from 'vitest'

import { deriveRunsMetrics, formatDuration, formatPercent } from '@/lib/runs-console/runs-metrics'
import { makeRun } from './runs-fixtures'

describe('deriveRunsMetrics', () => {
  it('counts each status and derives the success rate over finished runs only', () => {
    const metrics = deriveRunsMetrics([
      makeRun({ status: 'completed' }),
      makeRun({ status: 'completed' }),
      makeRun({ status: 'failed' }),
      makeRun({ status: 'blocked' }),
      makeRun({ status: 'running' }),
      makeRun({ status: 'needs-confirmation' }),
    ])

    expect(metrics.total).toBe(6)
    expect(metrics.completed).toBe(2)
    expect(metrics.failed).toBe(1)
    expect(metrics.blocked).toBe(1)
    expect(metrics.running).toBe(1)
    expect(metrics.needsConfirmation).toBe(1)
    // running + needs-confirmation are NOT finished, so they stay out of the rate.
    expect(metrics.terminal).toBe(4)
    expect(metrics.successRate).toBeCloseTo(0.5)
  })

  it('returns a null success rate when nothing has finished — never 0%', () => {
    const metrics = deriveRunsMetrics([
      makeRun({ status: 'running' }),
      makeRun({ status: 'needs-confirmation' }),
    ])

    expect(metrics.terminal).toBe(0)
    expect(metrics.successRate).toBeNull()
  })

  it('returns a null success rate for an empty set', () => {
    expect(deriveRunsMetrics([]).successRate).toBeNull()
    expect(deriveRunsMetrics([]).total).toBe(0)
  })

  it('sums only measured costs and reports how many were unmeasurable', () => {
    const metrics = deriveRunsMetrics([
      makeRun({ costUsd: 0.02 }),
      makeRun({ costUsd: 0.03 }),
      makeRun({ costUsd: null }),
    ])

    expect(metrics.measuredCostUsd).toBeCloseTo(0.05)
    expect(metrics.measuredCostRuns).toBe(2)
    expect(metrics.unmeasuredCostRuns).toBe(1)
  })

  it('returns a null cost when NO run had a measured cost — never a zero total', () => {
    const metrics = deriveRunsMetrics([makeRun({ costUsd: null }), makeRun({ costUsd: null })])

    expect(metrics.measuredCostUsd).toBeNull()
    expect(metrics.unmeasuredCostRuns).toBe(2)
  })

  it('counts runs that recorded a blocked/unsafe attempt', () => {
    const metrics = deriveRunsMetrics([
      makeRun({ unsafeAttemptCount: 0 }),
      makeRun({ unsafeAttemptCount: 3 }),
    ])

    expect(metrics.unsafeAttemptRuns).toBe(1)
  })
})

describe('formatDuration', () => {
  it('formats real latencies', () => {
    expect(formatDuration(450)).toBe('450ms')
    expect(formatDuration(12_000)).toBe('12.0s')
    expect(formatDuration(125_000)).toBe('2m 5s')
  })

  it('returns null for absent or nonsensical latency instead of "0ms"', () => {
    expect(formatDuration(null)).toBeNull()
    expect(formatDuration(undefined)).toBeNull()
    expect(formatDuration(Number.NaN)).toBeNull()
    expect(formatDuration(-1)).toBeNull()
  })
})

describe('formatPercent', () => {
  it('rounds to a whole percent', () => {
    expect(formatPercent(0.5)).toBe('50%')
    expect(formatPercent(1)).toBe('100%')
    expect(formatPercent(0.666)).toBe('67%')
  })
})
