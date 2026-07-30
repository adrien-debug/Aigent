/**
 * `buildRunsHourlyBuckets` — the one bucketing path behind every `/admin/runs`
 * chart. Truth invariants pinned here: a count bucket is 0 for a quiet hour
 * (a real measurement), a MEASUREMENT bucket (latency, cost) is `NaN` for an
 * hour that measured nothing (never 0, never a fabricated flat line).
 */
import { describe, expect, it } from 'vitest'

import { buildRunsHourlyBuckets } from '@/lib/runs-console/runs-timeseries'
import { makeRun } from './runs-fixtures'

const NOW_MS = Date.parse('2026-07-29T12:00:00.000Z')
const ONE_HOUR = 60 * 60 * 1000

describe('buildRunsHourlyBuckets', () => {
  it('buckets runs into their own hour, counts stay real zeros elsewhere', () => {
    const runs = [
      makeRun({ id: 'r1', startedAt: '2026-07-29T11:10:00.000Z', status: 'completed', latencyMs: 1000, costUsd: 1 }),
      makeRun({ id: 'r2', startedAt: '2026-07-29T11:40:00.000Z', status: 'failed', latencyMs: 3000, costUsd: null }),
    ]

    const buckets = buildRunsHourlyBuckets(runs, NOW_MS, ONE_HOUR)

    expect(buckets.xLabels).toEqual(['11:00'])
    expect(buckets.runsPerHour).toEqual([2])
    expect(buckets.completedPerHour).toEqual([1])
    expect(buckets.failedPerHour).toEqual([1])
    expect(buckets.errorsPerHour).toEqual([1])
    // avg of 1000 and 3000 = 2000
    expect(buckets.avgLatencyMsPerHour).toEqual([2000])
    // one of the two runs carried a measured cost — the sum is over that one.
    expect(buckets.costUsdPerHour).toEqual([1])
  })

  it('an hour with no runs is a real 0 count but an UNMEASURED (NaN) latency/cost', () => {
    const runs = [makeRun({ id: 'r1', startedAt: '2026-07-29T11:30:00.000Z' })]

    const buckets = buildRunsHourlyBuckets(runs, NOW_MS, 2 * ONE_HOUR)

    expect(buckets.xLabels).toEqual(['10:00', '11:00'])
    expect(buckets.runsPerHour).toEqual([0, 1])
    expect(Number.isNaN(buckets.avgLatencyMsPerHour[0])).toBe(true)
    expect(Number.isNaN(buckets.costUsdPerHour[0])).toBe(true)
  })

  it('clamps to 24 hourly buckets even for a wider span', () => {
    const buckets = buildRunsHourlyBuckets([], NOW_MS, 48 * ONE_HOUR)
    expect(buckets.xLabels).toHaveLength(24)
    expect(buckets.runsPerHour).toHaveLength(24)
  })
})
