/**
 * Unit test for getRegistryKpis (src/lib/agent-mission-control/data.ts).
 *
 * Pure, offline: pgrest is mocked. Two properties are pinned here.
 *
 * 1. THE OLD DETTE FIX (unchanged) — `avgTestPassRate` is computed from
 *    RUN-BACKED health (copilots that have a completed run), never by averaging
 *    the stale zero blobs, and a copilot serving a production version counts as
 *    active even though its stored `status` column still reads draft.
 *
 * 2. THE UNGUARDED SUM (this suite's reason to exist) — `runsLast24h` and
 *    `totalCostLast24hUsd` used to be
 *        copilots.reduce((s, c) => s + c.health.<metric>, 0)
 *    which consulted NOTHING. `data.ts › normalizeHealth` writes `0` into every
 *    health metric it could not read and names it in
 *    `Copilot.healthUnavailableFields`; that `0` is a PLACEHOLDER, not a
 *    measurement. So a fleet nobody had measured summed to a confident `0` runs
 *    and `$0.00`. Both fields now roll up through the shared
 *    `sumMeasuredHealth` (src/lib/agent-mission-control/health-measure.ts) and
 *    carry their coverage.
 *
 * The measurement states asserted below are exactly the ones the shared rollup
 * defines:
 *   no copilot at all, read OK  → measured 0 at FULL coverage
 *   every copilot measured      → the sum, FULL coverage
 *   only some measured          → the proven sum + the disclosed gap
 *   none measured               → null (renders "Indisponible"), never 0
 *   the read itself failed      → getCopilots() throws; nothing is returned
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type PgrestHandler = (method: string, path: string) => unknown

let pgrestHandler: PgrestHandler

/**
 * Copilot ids whose 24h metrics must arrive UNPROVEN.
 *
 * `resolve24hMetricsBatch` normally returns an entry for every id it is asked
 * about, so via `getCopilots()` the 24h fields are proven for everyone and the
 * defect cannot be observed end-to-end. `enrichCopilot` nevertheless has a real
 * `if (kpi24h)` branch: when the resolver has nothing for a copilot, that
 * copilot's `runsLast24h`/`costLast24hUsd` stay exactly as `normalizeHealth`
 * left them — i.e. placeholder `0`s named in `healthUnavailableFields` for a row
 * whose `health` jsonb is `{}` (which is literally what
 * `scripts/provision-tradeagent-roster.mjs` inserts). Dropping ids from the map
 * is how this suite reaches that branch; everything else stays the real code.
 */
const state = vi.hoisted(() => ({ omit24h: new Set<string>() }))

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async (method: string, path: string) => pgrestHandler(method, path)),
  // camelRow/camelRows are used by data.ts too — re-export the real impls.
  camelRow: (row: Record<string, unknown>) => camelReal(row),
  camelRows: (rows: Record<string, unknown>[]) => rows.map(camelReal),
}))

vi.mock('@/lib/agent-mission-control/agent-health', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent-mission-control/agent-health')>()
  return {
    ...actual,
    resolve24hMetricsBatch: async (ids: string[]) => {
      const resolved = await actual.resolve24hMetricsBatch(ids)
      for (const id of state.omit24h) resolved.delete(id)
      return resolved
    },
  }
})

// Minimal snake→camel for the two fields the KPI touches on our fixtures.
function camelReal<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    const ck = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    out[ck] = v
  }
  return out as T
}

import { getRegistryKpis } from '@/lib/agent-mission-control/data'

/**
 * Two copilots: "measured" has a completed test run (pass_rate 1); "draft" has
 * none. Both carry the OLD stale blob health.test_pass_rate = 0 in the copilots
 * row — the fix must ignore that and derive from runs.
 */
function installKpiMocks() {
  const measured = {
    id: 'copilot-measured',
    name: 'Measured',
    status: 'draft',
    production_version_id: 'v-prod', // serving production despite draft status
    health: { test_pass_rate: 0, benchmark_score: 0, runs_last24h: 3, error_rate_last24h: 0, avg_latency_ms: 0, cost_last24h_usd: 0.05, open_warnings: 0 },
  }
  const draft = {
    id: 'copilot-draft',
    name: 'Draft',
    status: 'draft',
    production_version_id: null,
    health: { test_pass_rate: 0, benchmark_score: 0, runs_last24h: 0, error_rate_last24h: 0, avg_latency_ms: 0, cost_last24h_usd: 0, open_warnings: 0 },
  }

  pgrestHandler = (_m, path) => {
    if (path.startsWith('copilots?')) return [measured, draft]
    if (path.startsWith('test_runs?')) {
      // Only "copilot-measured" has a completed run.
      if (path.includes(encodeURIComponent('copilot-measured')))
        return [{ id: 'tr', copilot_id: 'copilot-measured', pass_rate: 1, started_at: '2026-07-15T10:00:00Z' }]
      return []
    }
    if (path.startsWith('test_results?')) {
      // Cases of the measured copilot's run. getRegistryKpis does not surface
      // latency, but resolveCopilotHealthBatch resolves it on the way through.
      return [
        { run_id: 'tr', latency_ms: 120 },
        { run_id: 'tr', latency_ms: 180 },
      ]
    }
    if (path.startsWith('benchmark_runs?')) return []
    if (path.startsWith('benchmark_results?')) return []
    if (path.startsWith('agent_runs?')) return []
    throw new Error(`Unmocked pgrest path: ${path}`)
  }
}

/**
 * A fleet of copilot rows whose `health` jsonb is EMPTY — the shape a freshly
 * provisioned agent really has. Every metric therefore lands in
 * `healthUnavailableFields` with a placeholder `0`, unless a resolver proves it.
 */
function installFleetMocks(
  copilotIds: string[],
  agentRuns: { copilot_id: string; status: string; cost_usd: number | null }[] = []
) {
  const rows = copilotIds.map((id) => ({
    id,
    name: id,
    status: 'draft',
    production_version_id: null,
    health: {},
  }))
  pgrestHandler = (_m, path) => {
    if (path.startsWith('copilots?')) return rows
    if (path.startsWith('test_runs?')) return []
    if (path.startsWith('test_results?')) return []
    if (path.startsWith('benchmark_runs?')) return []
    if (path.startsWith('benchmark_results?')) return []
    if (path.startsWith('agent_runs?')) return agentRuns
    throw new Error(`Unmocked pgrest path: ${path}`)
  }
}

describe('getRegistryKpis', () => {
  beforeEach(() => {
    state.omit24h.clear()
    installKpiMocks()
  })

  it('avgTestPassRate uses run-backed health, not the stale zero blobs', async () => {
    const kpis = await getRegistryKpis()
    // Only the measured copilot counts; its real pass rate is 1 (100%).
    expect(kpis.avgTestPassRate).toBe(1)
    expect(kpis.totalCopilots).toBe(2)
  })

  it('a copilot serving production counts as active via displayStatus', async () => {
    const kpis = await getRegistryKpis()
    // "copilot-measured" has production_version_id → displayStatus production →
    // counted active, even though its stored status column is draft.
    expect(kpis.activeCopilots).toBe(1)
  })
})

describe('getRegistryKpis — an absent 24h measurement is never summed as zero', () => {
  beforeEach(() => {
    state.omit24h.clear()
  })

  it('an EMPTY fleet is a measured zero at full coverage, not an absence', async () => {
    installFleetMocks([])
    const kpis = await getRegistryKpis()

    expect(kpis.totalCopilots).toBe(0)
    // No agent means no run to have been made and no cost to have been
    // incurred: that zero is a FACT and must render as a real 0 / $0.00.
    expect(kpis.runsLast24h).toEqual({ value: 0, measured: 0, unmeasured: 0 })
    expect(kpis.totalCostLast24hUsd).toEqual({ value: 0, measured: 0, unmeasured: 0 })
  })

  it('a fleet whose 24h metrics nobody proved reads UNAVAILABLE, not 0 / $0.00', async () => {
    installFleetMocks(['a', 'b'])
    state.omit24h.add('a')
    state.omit24h.add('b')

    const kpis = await getRegistryKpis()

    // THE REGRESSION. Both copilots carry `health.runsLast24h === 0` and
    // `health.costLast24hUsd === 0` as normalisation placeholders, both named in
    // `healthUnavailableFields`. The old `reduce` added them and returned a
    // confident 0 / $0.00 over a fleet it had measured nothing about.
    expect(kpis.runsLast24h).toBeNull()
    expect(kpis.totalCostLast24hUsd).toBeNull()
    // Stated the other way round, because `null` and `0` are exactly what this
    // test exists to keep apart:
    expect(kpis.runsLast24h).not.toBe(0)
    expect(kpis.totalCostLast24hUsd).not.toBe(0)
    // The fleet itself is not in doubt — the READ succeeded, only the
    // measurements are missing.
    expect(kpis.totalCopilots).toBe(2)
  })

  it('a fully measured fleet reports the exact sum at full coverage', async () => {
    installFleetMocks(
      ['a', 'b'],
      [
        { copilot_id: 'a', status: 'completed', cost_usd: 0.25 },
        { copilot_id: 'a', status: 'completed', cost_usd: 0.25 },
        { copilot_id: 'b', status: 'completed', cost_usd: 0.5 },
      ]
    )

    const kpis = await getRegistryKpis()

    expect(kpis.runsLast24h).toEqual({ value: 3, measured: 2, unmeasured: 0 })
    expect(kpis.totalCostLast24hUsd).toEqual({ value: 1, measured: 2, unmeasured: 0 })
  })

  it('a quiet but READ fleet keeps a real measured zero (never collapsed to null)', async () => {
    installFleetMocks(['a', 'b']) // no agent_runs → the window was read, held nothing

    const kpis = await getRegistryKpis()

    expect(kpis.runsLast24h).toEqual({ value: 0, measured: 2, unmeasured: 0 })
    expect(kpis.totalCostLast24hUsd).toEqual({ value: 0, measured: 2, unmeasured: 0 })
  })

  it('a PARTIALLY measured fleet reports the proven sum and discloses the gap', async () => {
    installFleetMocks(
      ['proven', 'blind-1', 'blind-2'],
      [
        { copilot_id: 'proven', status: 'completed', cost_usd: 0.25 },
        { copilot_id: 'proven', status: 'completed', cost_usd: 0.25 },
      ]
    )
    state.omit24h.add('blind-1')
    state.omit24h.add('blind-2')

    const kpis = await getRegistryKpis()

    // The value covers ONE copilot out of three — a lower bound, and the
    // record says so instead of implying it covers the fleet.
    expect(kpis.runsLast24h).toEqual({ value: 2, measured: 1, unmeasured: 2 })
    expect(kpis.totalCostLast24hUsd).toEqual({ value: 0.5, measured: 1, unmeasured: 2 })
    expect(kpis.runsLast24h!.measured + kpis.runsLast24h!.unmeasured).toBe(kpis.totalCopilots)
  })

  it('avgTestPassRate is null, not 0%, when no copilot carries run evidence', async () => {
    installFleetMocks(['a', 'b']) // no test_runs, no benchmark_runs → evidence 'none'

    const kpis = await getRegistryKpis()

    // A never-tested fleet does not score zero percent.
    expect(kpis.avgTestPassRate).toBeNull()
  })

  it('a failed read THROWS — it never returns a fleet of zeros', async () => {
    pgrestHandler = () => {
      throw new Error('PostgREST unreachable')
    }
    await expect(getRegistryKpis()).rejects.toThrow('PostgREST unreachable')

    // Stated as a property and not only as a throw: whatever this call does, it
    // must never hand back an object whose 24h fields read as measured. The
    // `catch` is what a future "make the page resilient" refactor would add, and
    // this is the assertion that would then have to be faced instead of quietly
    // satisfied by a `?? 0`.
    const result = await getRegistryKpis().catch(() => null)
    expect(result).toBeNull()
  })
})

/**
 * NO LYING TOTAL — the same five states, read as ONE property.
 *
 * The cases above each pin a shape. This one pins the invariant that ties them
 * together and that the old `reduce` broke: a figure the KPI reports is backed
 * by `measured` agents out of `measured + unmeasured`, and it is `null` exactly
 * when nothing backs it. Written against the SAME fixtures so the two cannot
 * describe different fleets.
 */
describe('getRegistryKpis — the coverage record always accounts for the whole fleet', () => {
  beforeEach(() => {
    state.omit24h.clear()
  })

  const cases: { name: string; ids: string[]; runs: { copilot_id: string; status: string; cost_usd: number | null }[]; blind: string[] }[] = [
    { name: 'empty fleet', ids: [], runs: [], blind: [] },
    { name: 'quiet fleet (measured zero)', ids: ['a', 'b'], runs: [], blind: [] },
    {
      name: 'fully measured fleet',
      ids: ['a', 'b'],
      runs: [
        { copilot_id: 'a', status: 'completed', cost_usd: 0.25 },
        { copilot_id: 'b', status: 'completed', cost_usd: 0.5 },
      ],
      blind: [],
    },
    {
      name: 'partially measured fleet',
      ids: ['proven', 'blind-1', 'blind-2'],
      runs: [{ copilot_id: 'proven', status: 'completed', cost_usd: 0.25 }],
      blind: ['blind-1', 'blind-2'],
    },
    { name: 'nothing measured', ids: ['a', 'b'], runs: [], blind: ['a', 'b'] },
  ]

  for (const testCase of cases) {
    it(`${testCase.name} — the figure never claims more support than it has`, async () => {
      installFleetMocks(testCase.ids, testCase.runs)
      for (const id of testCase.blind) state.omit24h.add(id)

      const kpis = await getRegistryKpis()

      for (const sum of [kpis.runsLast24h, kpis.totalCostLast24hUsd]) {
        if (sum === null) {
          // `null` is only allowed when the fleet is NON-EMPTY and proved
          // nothing — never as a stand-in for an empty or a quiet fleet, which
          // are measured facts.
          expect(kpis.totalCopilots).toBeGreaterThan(0)
          expect(testCase.blind.length).toBe(kpis.totalCopilots)
          continue
        }
        // Every agent is either behind the figure or named in the gap. This is
        // what the old `copilots.reduce((s, c) => s + c.health.<metric>, 0)`
        // could not state: it produced a bare number whose support was unknown
        // and, on a fleet nobody had measured, indistinguishable from a real 0.
        expect(sum.measured + sum.unmeasured).toBe(kpis.totalCopilots)
        expect(sum.unmeasured).toBe(testCase.blind.length)
        // A figure with zero support cannot exist on a non-empty fleet.
        if (kpis.totalCopilots > 0) expect(sum.measured).toBeGreaterThan(0)
        // Nothing negative, nothing non-finite ever reaches a screen.
        expect(Number.isFinite(sum.value)).toBe(true)
        expect(sum.value).toBeGreaterThanOrEqual(0)
      }
    })
  }
})
