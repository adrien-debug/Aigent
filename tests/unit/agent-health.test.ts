/**
 * Unit tests for the canonical run-backed health/scores resolver
 * (src/lib/agent-mission-control/agent-health.ts).
 *
 * Pure, offline: pgrest is mocked — no network, no gpu1 backend, no secrets.
 * Covers the dette this module fixes: deriving testPassRate / benchmarkScore
 * from the latest COMPLETED run instead of the stale zero blob, and the
 * production display-status derivation.
 *
 * Convention (pass rate): testPassRate is kept as a 0..1 ratio end-to-end (the
 * DB column `test_runs.pass_rate` and the `CopilotHealth.testPassRate` type are
 * both 0..1); the UI formats it to a percentage at the edge. So a 5/5 run
 * resolves to 1, NOT 100.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type PgrestHandler = (method: string, path: string) => unknown

let pgrestHandler: PgrestHandler

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async (method: string, path: string) => pgrestHandler(method, path)),
}))

import {
  deriveDisplayStatus,
  resolve24hMetricsBatch,
  resolveCopilotHealth,
  resolveCopilotHealthBatch,
  resolveVersionScoresBatch,
} from '@/lib/agent-mission-control/agent-health'

const COPILOT = 'copilot-health-test'
const VERSION = 'version-health-test'

/** No runs anywhere — every table returns []. */
function noRuns(): PgrestHandler {
  return (_m, path) => {
    if (path.startsWith('test_runs?')) return []
    if (path.startsWith('test_results?')) return []
    if (path.startsWith('benchmark_runs?')) return []
    if (path.startsWith('benchmark_results?')) return []
    throw new Error(`Unmocked pgrest path: ${path}`)
  }
}

describe('resolveCopilotHealth', () => {
  beforeEach(() => {
    pgrestHandler = noRuns()
  })

  it('1 — no completed run → testPassRate null, evidenceSource none', async () => {
    const health = await resolveCopilotHealth(COPILOT)
    expect(health.testPassRate).toBeNull()
    expect(health.benchmarkScore).toBeNull()
    expect(health.evidenceSource).toBe('none')
    expect(health.latestTestRunId).toBeNull()
  })

  it('2 — latest test run pass_rate 1 → testPassRate 1 (0..1 convention), evidence runs', async () => {
    pgrestHandler = (_m, path) => {
      if (path.startsWith('test_runs?'))
        return [{ id: 'run-a', copilot_id: COPILOT, pass_rate: 1, started_at: '2026-07-15T10:00:00Z' }]
      if (path.startsWith('test_results?'))
        // Cases of run-a: mean of 100/200/300 = 200ms.
        return [
          { run_id: 'run-a', latency_ms: 100 },
          { run_id: 'run-a', latency_ms: 200 },
          { run_id: 'run-a', latency_ms: 300 },
        ]
      if (path.startsWith('benchmark_runs?')) return []
      if (path.startsWith('benchmark_results?')) return []
      throw new Error(`Unmocked pgrest path: ${path}`)
    }
    const health = await resolveCopilotHealth(COPILOT)
    expect(health.testPassRate).toBe(1)
    expect(health.latestTestRunId).toBe('run-a')
    expect(health.latestTestRunAt).toBe('2026-07-15T10:00:00Z')
    expect(health.evidenceSource).toBe('runs')
    expect(health.avgLatencyMs).toBe(200)
  })

  it('2b — list mode skips latency + benchmark round trips', async () => {
    const hit: string[] = []
    pgrestHandler = (_m, path) => {
      if (path.startsWith('test_runs?')) {
        hit.push('test_runs')
        return [{ id: 'run-a', copilot_id: COPILOT, pass_rate: 1, started_at: '2026-07-15T10:00:00Z' }]
      }
      if (path.startsWith('test_results?')) {
        hit.push('test_results')
        return [{ run_id: 'run-a', latency_ms: 100 }]
      }
      if (path.startsWith('benchmark_runs?')) {
        hit.push('benchmark_runs')
        return []
      }
      if (path.startsWith('benchmark_results?')) {
        hit.push('benchmark_results')
        return []
      }
      throw new Error(`Unmocked pgrest path: ${path}`)
    }
    const map = await resolveCopilotHealthBatch([COPILOT], {
      includeLatency: false,
      includeBenchmark: false,
    })
    const health = map.get(COPILOT)!
    expect(health.testPassRate).toBe(1)
    expect(health.evidenceSource).toBe('runs')
    expect(health.avgLatencyMs).toBeNull()
    expect(health.benchmarkScore).toBeNull()
    expect(hit).toEqual(['test_runs'])
  })

  it('3 — several runs → takes the most recent (rows arrive newest-first)', async () => {
    pgrestHandler = (_m, path) => {
      if (path.startsWith('test_runs?'))
        // Ordered started_at.desc by the query — newest first.
        return [
          { id: 'run-new', copilot_id: COPILOT, pass_rate: 0.8, started_at: '2026-07-15T12:00:00Z' },
          { id: 'run-old', copilot_id: COPILOT, pass_rate: 0.2, started_at: '2026-07-15T09:00:00Z' },
        ]
      if (path.startsWith('test_results?')) {
        // Latency is averaged over the WINNING run only — the resolver never even
        // asks for run-old's cases.
        expect(path).toContain('run-new')
        expect(path).not.toContain('run-old')
        return [
          { run_id: 'run-new', latency_ms: 40 },
          { run_id: 'run-new', latency_ms: 60 },
        ]
      }
      if (path.startsWith('benchmark_runs?')) return []
      if (path.startsWith('benchmark_results?')) return []
      throw new Error(`Unmocked pgrest path: ${path}`)
    }
    const health = await resolveCopilotHealth(COPILOT)
    expect(health.testPassRate).toBe(0.8)
    expect(health.latestTestRunId).toBe('run-new')
    expect(health.avgLatencyMs).toBe(50)
  })

  it('3b — test run whose cases carry no latency → avgLatencyMs null, never a fabricated 0', async () => {
    pgrestHandler = (_m, path) => {
      if (path.startsWith('test_runs?'))
        return [{ id: 'run-nolat', copilot_id: COPILOT, pass_rate: 1, started_at: '2026-07-15T10:00:00Z' }]
      if (path.startsWith('test_results?'))
        // Cases exist but latency was never recorded — a null must NOT average to 0.
        return [
          { run_id: 'run-nolat', latency_ms: null },
          { run_id: 'run-nolat', latency_ms: null },
        ]
      if (path.startsWith('benchmark_runs?')) return []
      if (path.startsWith('benchmark_results?')) return []
      throw new Error(`Unmocked pgrest path: ${path}`)
    }
    const health = await resolveCopilotHealth(COPILOT)
    expect(health.testPassRate).toBe(1)
    expect(health.avgLatencyMs).toBeNull()
  })

  it('4 — latest benchmark → benchmarkScore from its result', async () => {
    pgrestHandler = (_m, path) => {
      if (path.startsWith('test_runs?')) return []
      if (path.startsWith('test_results?')) return []
      if (path.startsWith('benchmark_runs?'))
        return [{ id: 'bench-1', copilot_id: COPILOT, started_at: '2026-07-15T11:00:00Z' }]
      if (path.startsWith('benchmark_results?')) return [{ run_id: 'bench-1', score: 93 }]
      throw new Error(`Unmocked pgrest path: ${path}`)
    }
    const health = await resolveCopilotHealth(COPILOT)
    expect(health.benchmarkScore).toBe(93)
    expect(health.latestBenchmarkRunId).toBe('bench-1')
    expect(health.evidenceSource).toBe('runs')
  })

  it('4b — benchmark run without a result row → no benchmark evidence', async () => {
    pgrestHandler = (_m, path) => {
      if (path.startsWith('test_runs?')) return []
      if (path.startsWith('test_results?')) return []
      if (path.startsWith('benchmark_runs?'))
        return [{ id: 'bench-orphan', copilot_id: COPILOT, started_at: '2026-07-15T11:00:00Z' }]
      if (path.startsWith('benchmark_results?')) return [] // no matching result
      throw new Error(`Unmocked pgrest path: ${path}`)
    }
    const health = await resolveCopilotHealth(COPILOT)
    expect(health.benchmarkScore).toBeNull()
    expect(health.evidenceSource).toBe('none')
  })

  it('batch — one copilot with runs, one without, resolved independently', async () => {
    const withRuns = 'copilot-a'
    const without = 'copilot-b'
    pgrestHandler = (_m, path) => {
      if (path.startsWith('test_runs?'))
        return [{ id: 'r1', copilot_id: withRuns, pass_rate: 0.5, started_at: '2026-07-15T10:00:00Z' }]
      if (path.startsWith('test_results?'))
        return [
          { run_id: 'r1', latency_ms: 10 },
          { run_id: 'r1', latency_ms: 21 },
        ]
      if (path.startsWith('benchmark_runs?')) return []
      if (path.startsWith('benchmark_results?')) return []
      throw new Error(`Unmocked pgrest path: ${path}`)
    }
    const map = await resolveCopilotHealthBatch([withRuns, without])
    expect(map.get(withRuns)!.testPassRate).toBe(0.5)
    expect(map.get(withRuns)!.evidenceSource).toBe('runs')
    // Mean of 10 and 21 is 15.5 → rounded to 16 by the resolver.
    expect(map.get(withRuns)!.avgLatencyMs).toBe(16)
    expect(map.get(without)!.testPassRate).toBeNull()
    expect(map.get(without)!.evidenceSource).toBe('none')
    // The run-less copilot borrows nothing from its neighbour.
    expect(map.get(without)!.avgLatencyMs).toBeNull()
  })
})

describe('resolveVersionScoresBatch', () => {
  it('derives per-version pass rate + benchmark pinned to version_id', async () => {
    pgrestHandler = (_m, path) => {
      if (path.startsWith('test_runs?'))
        return [{ id: 'tr', version_id: VERSION, pass_rate: 1, started_at: '2026-07-15T10:00:00Z' }]
      if (path.startsWith('benchmark_runs?'))
        return [{ id: 'br', version_id: VERSION, started_at: '2026-07-15T11:00:00Z' }]
      if (path.startsWith('benchmark_results?')) return [{ run_id: 'br', score: 88 }]
      throw new Error(`Unmocked pgrest path: ${path}`)
    }
    const map = await resolveVersionScoresBatch([VERSION])
    expect(map.get(VERSION)!.testPassRate).toBe(1)
    expect(map.get(VERSION)!.benchmarkScore).toBe(88)
    expect(map.get(VERSION)!.evidenceSource).toBe('runs')
  })

  it('un-run version → both null, evidence none', async () => {
    pgrestHandler = noRuns()
    const map = await resolveVersionScoresBatch([VERSION])
    expect(map.get(VERSION)!.testPassRate).toBeNull()
    expect(map.get(VERSION)!.benchmarkScore).toBeNull()
    expect(map.get(VERSION)!.evidenceSource).toBe('none')
  })
})

describe('deriveDisplayStatus', () => {
  it('5 — production_version_id non-null → production even if status is draft', () => {
    expect(deriveDisplayStatus({ status: 'draft', productionVersionId: 'v-prod' })).toBe('production')
  })

  it('5b — version stage production (no pointer) → production', () => {
    expect(
      deriveDisplayStatus({ status: 'draft', productionVersionId: null, productionStage: 'production' })
    ).toBe('production')
  })

  it('6 — production_version_id null + status draft → draft', () => {
    expect(deriveDisplayStatus({ status: 'draft', productionVersionId: null })).toBe('draft')
  })

  it('6b — passes through other statuses untouched', () => {
    expect(deriveDisplayStatus({ status: 'paused', productionVersionId: null })).toBe('paused')
    expect(deriveDisplayStatus({ status: 'active', productionVersionId: null })).toBe('active')
  })
})

/**
 * `resolve24hMetricsBatch` used to pre-seed every requested id with the zero
 * baseline BEFORE the read, then always overwrite every id at the end — so a
 * read failure (uncaught) crashed the whole caller instead of leaving the
 * batch's ids absent, and a read that DID reach the final loop could never
 * leave an id genuinely unproven. Both meant `enrichCopilot`'s `if (kpi24h)`
 * branch (data.ts) — which marks `runsLast24h`/`costLast24hUsd` unavailable
 * for a missing map entry — was structurally unreachable via the real
 * function. These pin the fix: FAIL-SOFT, and the absence is a MISSING id,
 * never a seeded zero.
 */
describe('resolve24hMetricsBatch', () => {
  it('7 — no run in the window → a real measured 0, present in the map', async () => {
    pgrestHandler = (_m, path) => {
      if (path.startsWith('agent_runs?')) return []
      throw new Error(`Unmocked pgrest path: ${path}`)
    }
    const map = await resolve24hMetricsBatch([COPILOT])
    expect(map.get(COPILOT)).toEqual({ runsLast24h: 0, costLast24hUsd: 0, errorRateLast24h: 0 })
  })

  it('8 — runs present → summed correctly, losslessly, per copilot', async () => {
    pgrestHandler = (_m, path) => {
      if (path.startsWith('agent_runs?'))
        return [
          { copilot_id: COPILOT, status: 'completed', cost_usd: 0.1 },
          { copilot_id: COPILOT, status: 'failed', cost_usd: 0.2 },
          { copilot_id: 'copilot-other', status: 'completed', cost_usd: 5 },
        ]
      throw new Error(`Unmocked pgrest path: ${path}`)
    }
    const map = await resolve24hMetricsBatch([COPILOT, 'copilot-other'])
    expect(map.get(COPILOT)).toEqual({ runsLast24h: 2, costLast24hUsd: 0.3, errorRateLast24h: 0.5 })
    expect(map.get('copilot-other')).toEqual({ runsLast24h: 1, costLast24hUsd: 5, errorRateLast24h: 0 })
  })

  it('9 — the read FAILS → every requested id is MISSING, never seeded with the zero baseline', async () => {
    pgrestHandler = () => {
      throw new Error('PostgREST unreachable')
    }
    const map = await resolve24hMetricsBatch([COPILOT, 'copilot-other'])
    expect(map.size).toBe(0)
    expect(map.has(COPILOT)).toBe(false)
    expect(map.get(COPILOT)).toBeUndefined()
  })

  it('10 — ANTI-REGRESSION: a failed read and a genuinely-empty window are NOT the same map', async () => {
    pgrestHandler = (_m, path) => {
      if (path.startsWith('agent_runs?')) return []
      throw new Error(`Unmocked pgrest path: ${path}`)
    }
    const empty = await resolve24hMetricsBatch([COPILOT])

    pgrestHandler = () => {
      throw new Error('PostgREST unreachable')
    }
    const failed = await resolve24hMetricsBatch([COPILOT])

    expect(empty.has(COPILOT)).toBe(true) // measured, a real 0
    expect(failed.has(COPILOT)).toBe(false) // unproven, absent from the map
  })
})
