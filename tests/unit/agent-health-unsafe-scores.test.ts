/**
 * Unit tests for `resolveVersionScoresBatch().unsafeActionCount`
 * (src/lib/agent-mission-control/agent-health.ts).
 *
 * Pure, offline: pgrest is mocked — no network, no gpu1 backend, no secrets.
 *
 * The dette these cover: `unsafeActionCount` used to be served from the stored
 * `copilot_versions.scores` blob (zero-initialised at authoring, never
 * recomputed) — the very blob the release gate refuses to trust. The resolver
 * now reads `benchmark_results.unsafe_action_count` of the newest COMPLETED
 * benchmark run pinned to the version, i.e. the gate's own evidence.
 *
 * Truth doctrine: never benchmarked ⇒ `null`, never `0`. `0` is the measured
 * claim "no unsafe action was attempted"; emitting it for an unmeasured version
 * would fabricate a safety guarantee.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type PgrestHandler = (method: string, path: string) => unknown

let pgrestHandler: PgrestHandler

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async (method: string, path: string) => pgrestHandler(method, path)),
}))

import { resolveVersionScoresBatch } from '@/lib/agent-mission-control/agent-health'

const VERSION = 'ver-unsafe-test'

/** Backend where the version has one completed benchmark run with `unsafe` unsafe actions. */
function benchmarked(unsafe: number | null): PgrestHandler {
  return (_m, path) => {
    if (path.startsWith('test_runs?')) return []
    if (path.startsWith('benchmark_runs?')) return [{ id: 'bench-1', version_id: VERSION, started_at: '2026-07-01T00:00:00Z' }]
    if (path.startsWith('benchmark_results?')) {
      return [{ run_id: 'bench-1', score: 88, ...(unsafe === null ? {} : { unsafe_action_count: unsafe }) }]
    }
    throw new Error(`unexpected pgrest path: ${path}`)
  }
}

/** Backend with no run of any kind pinned to the version. */
const noRuns: PgrestHandler = (_m, path) => {
  if (path.startsWith('test_runs?')) return []
  if (path.startsWith('benchmark_runs?')) return []
  throw new Error(`unexpected pgrest path: ${path}`)
}

describe('resolveVersionScoresBatch — unsafeActionCount', () => {
  beforeEach(() => {
    pgrestHandler = noRuns
  })

  it('resolves the live count from the completed benchmark run', async () => {
    pgrestHandler = benchmarked(3)
    const resolved = (await resolveVersionScoresBatch([VERSION])).get(VERSION)
    expect(resolved?.unsafeActionCount).toBe(3)
    expect(resolved?.evidenceSource).toBe('runs')
  })

  it('resolves a genuine measured zero as 0, not null', async () => {
    pgrestHandler = benchmarked(0)
    expect((await resolveVersionScoresBatch([VERSION])).get(VERSION)?.unsafeActionCount).toBe(0)
  })

  it('returns null — never 0 — for a version that was never benchmarked', async () => {
    const resolved = (await resolveVersionScoresBatch([VERSION])).get(VERSION)
    expect(resolved?.unsafeActionCount).toBeNull()
    expect(resolved?.unsafeActionCount).not.toBe(0)
    expect(resolved?.evidenceSource).toBe('none')
  })

  it('returns null when the completed run recorded no count at all', async () => {
    pgrestHandler = benchmarked(null)
    expect((await resolveVersionScoresBatch([VERSION])).get(VERSION)?.unsafeActionCount).toBeNull()
  })

  it('lets the real run win over a stored blob claiming zero (the whole point)', async () => {
    // The stored `copilot_versions.scores` blob says 0; the pinned run says 3.
    // The resolver is blob-blind by construction — it only ever reads runs — so
    // the value it hands back is the run's, and the blob cannot mask it.
    pgrestHandler = benchmarked(3)
    const storedBlobUnsafeActionCount = 0
    const resolved = (await resolveVersionScoresBatch([VERSION])).get(VERSION)
    expect(resolved?.unsafeActionCount).toBe(3)
    expect(resolved?.unsafeActionCount).not.toBe(storedBlobUnsafeActionCount)
  })

  it('keeps per-version isolation in a batch: one benchmarked, one never run', async () => {
    const OTHER = 'ver-never-run'
    pgrestHandler = (_m, path) => {
      if (path.startsWith('test_runs?')) return []
      if (path.startsWith('benchmark_runs?')) return [{ id: 'bench-1', version_id: VERSION, started_at: '2026-07-01T00:00:00Z' }]
      if (path.startsWith('benchmark_results?')) return [{ run_id: 'bench-1', score: 88, unsafe_action_count: 2 }]
      throw new Error(`unexpected pgrest path: ${path}`)
    }
    const map = await resolveVersionScoresBatch([VERSION, OTHER])
    expect(map.get(VERSION)?.unsafeActionCount).toBe(2)
    expect(map.get(OTHER)?.unsafeActionCount).toBeNull()
  })
})
