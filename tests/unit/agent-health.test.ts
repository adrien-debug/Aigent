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
      if (path.startsWith('benchmark_runs?')) return []
      if (path.startsWith('benchmark_results?')) return []
      throw new Error(`Unmocked pgrest path: ${path}`)
    }
    const health = await resolveCopilotHealth(COPILOT)
    expect(health.testPassRate).toBe(1)
    expect(health.latestTestRunId).toBe('run-a')
    expect(health.latestTestRunAt).toBe('2026-07-15T10:00:00Z')
    expect(health.evidenceSource).toBe('runs')
  })

  it('3 — several runs → takes the most recent (rows arrive newest-first)', async () => {
    pgrestHandler = (_m, path) => {
      if (path.startsWith('test_runs?'))
        // Ordered started_at.desc by the query — newest first.
        return [
          { id: 'run-new', copilot_id: COPILOT, pass_rate: 0.8, started_at: '2026-07-15T12:00:00Z' },
          { id: 'run-old', copilot_id: COPILOT, pass_rate: 0.2, started_at: '2026-07-15T09:00:00Z' },
        ]
      if (path.startsWith('benchmark_runs?')) return []
      if (path.startsWith('benchmark_results?')) return []
      throw new Error(`Unmocked pgrest path: ${path}`)
    }
    const health = await resolveCopilotHealth(COPILOT)
    expect(health.testPassRate).toBe(0.8)
    expect(health.latestTestRunId).toBe('run-new')
  })

  it('4 — latest benchmark → benchmarkScore from its result', async () => {
    pgrestHandler = (_m, path) => {
      if (path.startsWith('test_runs?')) return []
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
      if (path.startsWith('benchmark_runs?')) return []
      if (path.startsWith('benchmark_results?')) return []
      throw new Error(`Unmocked pgrest path: ${path}`)
    }
    const map = await resolveCopilotHealthBatch([withRuns, without])
    expect(map.get(withRuns)!.testPassRate).toBe(0.5)
    expect(map.get(withRuns)!.evidenceSource).toBe('runs')
    expect(map.get(without)!.testPassRate).toBeNull()
    expect(map.get(without)!.evidenceSource).toBe('none')
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
