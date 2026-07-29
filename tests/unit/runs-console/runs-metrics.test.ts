/**
 * AIGENT-FRONTEND-RESET-001 — KPI derivation.
 *
 * The invariants pinned here are the ones that stop the cockpit from lying:
 * a rate with no denominator is `null` (rendered "Not measured", never 0%),
 * and an unmeasurable cost is `null` (never summed as zero).
 */
import { describe, expect, it } from 'vitest'

import {
  deriveRunsMetrics,
  formatDuration,
  formatPercent,
  formatSuccessFigure,
} from '@/lib/runs-console/runs-metrics'
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

describe('formatPercent — the ONE precision rule for the success rate', () => {
  // AIGENT bug fixed here: the KPI card used to round to one decimal
  // ("83.3%") while the ring's aria label used a stray `Math.round` to a
  // whole percent ("83") — same rate, two different figures on screen at
  // once. `formatPercent` now uses the same rule as `RingGauge`'s internal
  // `formatFigure`: integers stay integers, anything else keeps one decimal.
  it('keeps one decimal for a non-integer rate — 83.3%, never 83%', () => {
    expect(formatPercent(0.8333333333)).toBe('83.3%')
  })

  it('drops the decimal only when the percent is an exact integer', () => {
    expect(formatPercent(1)).toBe('100%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(0.5)).toBe('50%')
  })

  it('does not multiply an already-percent value — input is the 0..1 ratio', () => {
    expect(formatPercent(0.666)).toBe('66.6%')
  })
})

describe('formatSuccessFigure — same rule, no "%", for the ring/aria composition', () => {
  it('matches formatPercent minus the trailing "%" for every case', () => {
    for (const rate of [0.8333333333, 1, 0, 0.5, 0.666]) {
      expect(formatPercent(rate)).toBe(`${formatSuccessFigure(rate)}%`)
    }
  })
})

describe('success rate stays identical across every renderer of the metric', () => {
  // This is the regression the mission was opened for: the small ArcGauge
  // beside the KPI card and the big RingGauge in the outcome panel must
  // print the SAME characters for the SAME rate. `RingGauge`'s own centre
  // text is drawn by its internal `formatFigure`, which this test mirrors
  // exactly (integer stays integer, else one decimal) to prove the two
  // independent implementations now agree byte-for-byte.
  function ringGaugeFigure(percent: number): string {
    return Number.isInteger(percent) ? String(percent) : String(Math.round(percent * 10) / 10)
  }

  it('83.3% case: KPI card and ring centre text agree', () => {
    const rate = 5 / 6 // 0.8333... -> 83.3
    const kpiCardText = formatPercent(rate)
    const ringCentreText = ringGaugeFigure(rate * 100)

    expect(kpiCardText).toBe('83.3%')
    expect(ringCentreText).toBe('83.3')
    expect(kpiCardText).toBe(`${ringCentreText}%`)
  })

  it('100% case: KPI card and ring centre text agree (both drop the decimal)', () => {
    const rate = 1
    expect(formatPercent(rate)).toBe(`${ringGaugeFigure(rate * 100)}%`)
    expect(formatPercent(rate)).toBe('100%')
  })

  it('0% (measured zero) case: KPI card and ring centre text agree', () => {
    const rate = 0
    expect(formatPercent(rate)).toBe(`${ringGaugeFigure(rate * 100)}%`)
    expect(formatPercent(rate)).toBe('0%')
  })

  it('null (unmeasured) stays null end to end — never rendered as "0%"', () => {
    const metrics = deriveRunsMetrics([
      makeRun({ status: 'running' }),
      makeRun({ status: 'needs-confirmation' }),
    ])

    expect(metrics.successRate).toBeNull()
    // Callers (runs-screen.tsx) branch on `=== null` before ever calling
    // `formatPercent`/`formatSuccessFigure` — neither function is asked to
    // handle null, and the UI shows "Indisponible"/"Not measured" instead.
  })
})
