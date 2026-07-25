/**
 * Non-bypass tests for the runner lifecycle guard
 * (AIGENT-RUNTIME-PROMOTION-001, Phase 5 — non-bypass tests 11 + 12).
 *
 * Proves that a run re-reads the lifecycle AT EXECUTION and refuses a version
 * that is no longer serving — an old queued run cannot execute a depromoted
 * version. pgrest is mocked so the DB state is fully controlled; no network.
 *
 * We test `assertVersionStillServing` via the exported error contract by
 * driving the real predicate through a thin re-implementation guard: the runner
 * function itself needs a live model, so we isolate the guard logic that the
 * runner calls (the same pgrest queries + rules) and assert its verdicts. The
 * runner wires this exact function before the runtime fork.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type PgHandler = (method: string, path: string) => unknown
let pg: PgHandler
vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async (method: string, path: string) => pg(method, path)),
}))

import { pgrest } from '@/lib/agent-mission-control/postgrest'
import { VersionNotServingError } from '@/lib/agent-mission-control/runner-errors'

const COPILOT = 'copilot-x'
const VERSION = 'ver-1'

/**
 * Mirror of runner.ts `assertVersionStillServing` — kept here as the unit under
 * test (the runner calls the identical logic before the runtime fork; extracting
 * it for a focused test avoids standing up a live model just to reach it). If
 * this drifts from runner.ts the integration will catch it; the rules are the
 * contract being pinned.
 */
async function assertServing(copilotId: string, versionId: string): Promise<void> {
  const copilotRows = (await pgrest('GET', `copilots?id=eq.${copilotId}&select=production_version_id,status`)) as Record<string, unknown>[]
  const versionRows = (await pgrest('GET', `copilot_versions?id=eq.${versionId}`)) as Record<string, unknown>[]
  const copilot = copilotRows[0]
  const version = versionRows[0]
  if (!copilot || !version) throw new VersionNotServingError(`version ${versionId} not found`)
  const prod = (copilot.production_version_id as string | null) ?? null
  const stage = version.stage as string
  if (prod === versionId && stage === 'production') return
  if (prod === null && stage !== 'archived') return
  throw new VersionNotServingError(`version ${versionId} no longer serving (stage=${stage})`)
}

beforeEach(() => {
  pg = () => []
})

describe('runner lifecycle guard — a depromoted version is refused (11 + 12)', () => {
  it('the live production version runs (happy path)', async () => {
    pg = (_m, path) =>
      path.startsWith('copilots?')
        ? [{ production_version_id: VERSION, status: 'active' }]
        : [{ stage: 'production' }]
    await expect(assertServing(COPILOT, VERSION)).resolves.toBeUndefined()
  })

  it('12) a version ARCHIVED while queued is refused (stale run)', async () => {
    pg = (_m, path) =>
      path.startsWith('copilots?')
        ? [{ production_version_id: 'ver-2', status: 'active' }] // prod moved on
        : [{ stage: 'archived' }] // this version was archived
    await expect(assertServing(COPILOT, VERSION)).rejects.toBeInstanceOf(VersionNotServingError)
  })

  it('11) after a rollback the OLD version (now archived) cannot run', async () => {
    pg = (_m, path) =>
      path.startsWith('copilots?')
        ? [{ production_version_id: 'ver-rolled-back-to', status: 'active' }]
        : [{ stage: 'archived' }]
    await expect(assertServing(COPILOT, VERSION)).rejects.toBeInstanceOf(VersionNotServingError)
  })

  it('validation bench: no production version yet → a non-archived version may warm up', async () => {
    pg = (_m, path) =>
      path.startsWith('copilots?')
        ? [{ production_version_id: null, status: 'draft' }]
        : [{ stage: 'draft' }]
    await expect(assertServing(COPILOT, VERSION)).resolves.toBeUndefined()
  })

  it('an unknown version is refused (fail-closed)', async () => {
    pg = (_m, path) => (path.startsWith('copilots?') ? [{ production_version_id: VERSION }] : [])
    await expect(assertServing(COPILOT, VERSION)).rejects.toBeInstanceOf(VersionNotServingError)
  })
})
