/**
 * Unit tests — THE measurement rule and THE rollup built on it
 * (`src/lib/agent-mission-control/health-measure.ts`).
 *
 * WHAT THIS SUITE IS FOR. Both figures the dashboard rolls up per team —
 * "Runs · 24h" and "Cost · 24h" — used to be plain `reduce` sums over
 * `copilot.health.<metric>`. That blob is NORMALISED: `data.ts › normalizeHealth`
 * writes a `0` into every metric it could not prove (the field is typed
 * `number`) and names the metric in `Copilot.healthUnavailableFields`. So the
 * number alone cannot say whether it is a measurement or a filler, and summing
 * it turned "nobody measured this fleet" into a confident `0 runs` / `$0.00`.
 *
 * The rule that tells them apart used to exist TWICE — byte for byte identical,
 * once in the server-only data layer and once inside the `/admin/projects`
 * component, because a value import of the data layer throws under the browser
 * resolve conditions the component suite runs in. It now lives once, here, in a
 * neutral module. This file tests that module DIRECTLY: every other suite
 * reaches it through a rollup or a screen, where a broken gate can hide behind
 * a fixture that happens not to exercise it.
 *
 * THE FIVE STATES the contract distinguishes, and which nothing may collapse:
 *   empty team / no run, read OK  → a MEASURED zero at full coverage
 *   everything measured           → the exact sum, full coverage
 *   partially measured            → the PROVEN sum, coverage gap disclosed
 *   nothing measured              → `null` (renders `Indisponible`), never 0
 *   never read at all             → `null` too, for a different reason
 *
 * The five are asserted from `tests/fixtures/health-measure-states.ts`, the same
 * table `tests/unit/health-measure-client.test.tsx` runs in the browser project.
 * See that fixture's header for why the answers are not written out twice.
 */
import { describe, expect, it } from 'vitest'

import { isMeasuredHealth, sumMeasuredHealth } from '@/lib/agent-mission-control/health-measure'
import type { Copilot, CopilotHealthMetric } from '@/lib/agent-mission-control/types'

import {
  MEASURED_METRICS,
  MEASUREMENT_STATES,
  measureCopilot,
} from '../fixtures/health-measure-states'

/* ------------------------------------------------------------------ helpers */

/** A copilot carrying an ARBITRARY health blob — including shapes the type
 *  forbids but PostgREST really returns (a partial `health: {}` jsonb cast by
 *  `camelRows` without validation, which is literally what
 *  `scripts/provision-tradeagent-roster.mjs` inserts). */
function withHealth(
  health: Partial<Copilot['health']>,
  healthUnavailableFields: CopilotHealthMetric[] | undefined = []
): Copilot {
  const base = measureCopilot({ id: 'c1', runsLast24h: 0, costLast24hUsd: 0, healthUnavailableFields })
  return { ...base, health: health as Copilot['health'] }
}

/* ================================================================= the rule */

describe('isMeasuredHealth — the three gates, each on its own', () => {
  it('GATE 1 — `healthUnavailableFields === undefined` proves NOTHING, however good the number looks', () => {
    // A raw PostgREST row cast by `camelRows` lands here: it never went through
    // `enrichCopilot`, so no metric on it has been proven. The `7` and the
    // `1.25` are perfectly finite and must still not count.
    const raw = measureCopilot({
      id: 'raw',
      runsLast24h: 7,
      costLast24hUsd: 1.25,
      healthUnavailableFields: undefined,
    })

    expect(isMeasuredHealth(raw, 'runsLast24h')).toBe(false)
    expect(isMeasuredHealth(raw, 'costLast24hUsd')).toBe(false)
    // Every metric, not just the two the dashboard sums.
    expect(isMeasuredHealth(raw, 'testPassRate')).toBe(false)
    expect(isMeasuredHealth(raw, 'benchmarkScore')).toBe(false)
    expect(isMeasuredHealth(raw, 'errorRateLast24h')).toBe(false)
    expect(isMeasuredHealth(raw, 'avgLatencyMs')).toBe(false)
  })

  it('GATE 2 — a metric named in the list is a PLACEHOLDER, whatever number sits in the blob', () => {
    const named = measureCopilot({
      id: 'named',
      runsLast24h: 999,
      costLast24hUsd: 999,
      healthUnavailableFields: ['runsLast24h', 'costLast24hUsd'],
    })

    expect(isMeasuredHealth(named, 'runsLast24h')).toBe(false)
    expect(isMeasuredHealth(named, 'costLast24hUsd')).toBe(false)
    // The real stored placeholder is `0`, and it is refused for the same reason
    // — the value is never what decides.
    const zeroed = measureCopilot({
      id: 'zeroed',
      runsLast24h: 0,
      costLast24hUsd: 0,
      healthUnavailableFields: ['runsLast24h', 'costLast24hUsd'],
    })
    expect(isMeasuredHealth(zeroed, 'runsLast24h')).toBe(false)
  })

  it('GATE 3 — a read row with a finite value IS a measurement, and a measured 0 is one too', () => {
    const measured = measureCopilot({
      id: 'measured',
      runsLast24h: 3,
      costLast24hUsd: 0.75,
      healthUnavailableFields: [],
    })
    expect(isMeasuredHealth(measured, 'runsLast24h')).toBe(true)
    expect(isMeasuredHealth(measured, 'costLast24hUsd')).toBe(true)

    // THE case the whole branch exists for: a real zero is a real measurement.
    const quiet = measureCopilot({ id: 'quiet', runsLast24h: 0, costLast24hUsd: 0, healthUnavailableFields: [] })
    expect(isMeasuredHealth(quiet, 'runsLast24h')).toBe(true)
    expect(isMeasuredHealth(quiet, 'costLast24hUsd')).toBe(true)
  })

  it('GATE 3 — `NaN`, `±Infinity` and a MISSING key are not measurements', () => {
    expect(isMeasuredHealth(withHealth({ runsLast24h: Number.NaN }), 'runsLast24h')).toBe(false)
    expect(isMeasuredHealth(withHealth({ runsLast24h: Number.POSITIVE_INFINITY }), 'runsLast24h')).toBe(false)
    expect(isMeasuredHealth(withHealth({ runsLast24h: Number.NEGATIVE_INFINITY }), 'runsLast24h')).toBe(false)
    // `health: {}` is the shape the provisioning script really inserts; the
    // metric reads `undefined` and must not pass as measured.
    expect(isMeasuredHealth(withHealth({}), 'runsLast24h')).toBe(false)
    expect(isMeasuredHealth(withHealth({}), 'costLast24hUsd')).toBe(false)
  })

  it('the gate is PER METRIC — one absent figure never disqualifies its neighbour', () => {
    const half = measureCopilot({
      id: 'half',
      runsLast24h: 6,
      costLast24hUsd: 999,
      healthUnavailableFields: ['costLast24hUsd'],
    })
    expect(isMeasuredHealth(half, 'runsLast24h')).toBe(true)
    expect(isMeasuredHealth(half, 'costLast24hUsd')).toBe(false)

    // …and the mirror image, so the rule cannot be reading one field for both.
    const mirror = measureCopilot({
      id: 'mirror',
      runsLast24h: 999,
      costLast24hUsd: 6,
      healthUnavailableFields: ['runsLast24h'],
    })
    expect(isMeasuredHealth(mirror, 'runsLast24h')).toBe(false)
    expect(isMeasuredHealth(mirror, 'costLast24hUsd')).toBe(true)
  })
})

/* ============================================================== the rollup */

describe('sumMeasuredHealth — the five states, from the shared table', () => {
  for (const state of MEASUREMENT_STATES) {
    for (const { metric, key } of MEASURED_METRICS) {
      it(`${state.name} · ${metric}`, () => {
        const sum = sumMeasuredHealth(state.team, metric)
        expect(sum).toEqual(state.expected[key])

        if (state.isAbsent) {
          // `null` and `0` are exactly what this module exists to keep apart, so
          // the absence is stated the other way round as well: an absent figure
          // is not a zero-valued sum, and it is not the number 0 either.
          expect(sum).toBeNull()
          expect(sum).not.toEqual({ value: 0, measured: 0, unmeasured: state.team.length })
          expect(sum as unknown).not.toBe(0)
        } else {
          if (sum === null) throw new Error('a measured state must not return null')
          // The coverage record always accounts for the WHOLE team — a member is
          // either counted in the figure or counted in the gap, never dropped.
          expect(sum.measured + sum.unmeasured).toBe(state.team.length)
          // `measured === 0` can only ever mean "empty team": a non-empty team
          // proving nothing is the `null` branch above.
          if (sum.measured === 0) expect(state.team).toHaveLength(0)
        }
      })
    }
  }
})

describe('sumMeasuredHealth — what the figure may and may not contain', () => {
  it('a placeholder is NEVER added into the total, not even a plausible one', () => {
    // `blind` carries 999 runs and $999 as normalisation fillers. A sum that
    // read past its own gate would return 1002 / 1000.25 — figures no honest
    // rollup can reach, which is why the fixture uses 999 rather than 0.
    const team = [
      measureCopilot({ id: 'proven', runsLast24h: 3, costLast24hUsd: 1.25, healthUnavailableFields: [] }),
      measureCopilot({
        id: 'blind',
        runsLast24h: 999,
        costLast24hUsd: 999,
        healthUnavailableFields: ['runsLast24h', 'costLast24hUsd'],
      }),
    ]

    expect(sumMeasuredHealth(team, 'runsLast24h')).toEqual({ value: 3, measured: 1, unmeasured: 1 })
    expect(sumMeasuredHealth(team, 'costLast24hUsd')).toEqual({ value: 1.25, measured: 1, unmeasured: 1 })
  })

  it('PARTIAL coverage makes the value a LOWER BOUND, and the record says so', () => {
    const team = [
      measureCopilot({ id: 'a', runsLast24h: 2, costLast24hUsd: 0.5, healthUnavailableFields: [] }),
      measureCopilot({ id: 'b', runsLast24h: 5, costLast24hUsd: 999, healthUnavailableFields: ['costLast24hUsd'] }),
    ]

    const runs = sumMeasuredHealth(team, 'runsLast24h')
    const cost = sumMeasuredHealth(team, 'costLast24hUsd')

    // Runs cover the whole team → the caller may claim completeness.
    expect(runs).toEqual({ value: 7, measured: 2, unmeasured: 0 })
    // Cost covers one agent out of two → the caller must disclose the gap. The
    // two metrics disagree about coverage on the SAME team, which is the reason
    // coverage travels with each figure instead of being derived once per team.
    expect(cost).toEqual({ value: 0.5, measured: 1, unmeasured: 1 })
  })

  it('the two metrics are gated independently — a dark cost never darkens the runs', () => {
    const team = [
      measureCopilot({
        id: 'runs-only',
        runsLast24h: 6,
        costLast24hUsd: 999,
        healthUnavailableFields: ['costLast24hUsd'],
      }),
    ]

    expect(sumMeasuredHealth(team, 'runsLast24h')).toEqual({ value: 6, measured: 1, unmeasured: 0 })
    // One member, and it proved no cost → the ABSENT branch, not a zero.
    expect(sumMeasuredHealth(team, 'costLast24hUsd')).toBeNull()
  })

  it('a single unread row (fields undefined) is enough to make a one-agent team absent', () => {
    const team = [
      measureCopilot({ id: 'raw', runsLast24h: 12, costLast24hUsd: 3, healthUnavailableFields: undefined }),
    ]
    expect(sumMeasuredHealth(team, 'runsLast24h')).toBeNull()
    expect(sumMeasuredHealth(team, 'costLast24hUsd')).toBeNull()
  })

  it('is PURE — it neither mutates the team nor the health blobs it reads', () => {
    const team = [
      measureCopilot({ id: 'a', runsLast24h: 3, costLast24hUsd: 1.5, healthUnavailableFields: [] }),
      measureCopilot({ id: 'b', runsLast24h: 999, costLast24hUsd: 999, healthUnavailableFields: ['runsLast24h'] }),
    ]
    const before = structuredClone(team)

    sumMeasuredHealth(team, 'runsLast24h')
    sumMeasuredHealth(team, 'costLast24hUsd')

    expect(team).toEqual(before)
  })
})
