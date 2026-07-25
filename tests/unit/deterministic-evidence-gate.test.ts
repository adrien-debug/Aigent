/**
 * AIGENT-DETERMINISTIC-EVIDENCE-001 — evidence↔gate integrity.
 *
 * The remaining required scenarios, at the gate layer:
 *   (6, enforced) a fixture-backed run NEVER satisfies a production promotion —
 *       the release gate reads execution_mode=eq.live only;
 *   (11) evidence bound to the WRONG version is refused — the gate filters on the
 *       candidate's version_id;
 *   (14b) a newer LIVE run supersedes an older one — the gate reads the latest
 *       completed run (order=started_at.desc&limit=1), so a green run logically
 *       replaces an earlier red one;
 *   (10) a non-deterministic result is LABELLED, never hidden — the replay engine
 *       returns INCONCLUSIVE with the case tagged `nondeterministic`.
 *
 * pgrest is mocked and HONOURS the execution_mode / version_id filters exactly as
 * PostgREST would, so the assertions test the real gate query, not a stub.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const pgrest = vi.fn()
vi.mock('@/lib/agent-mission-control/postgrest', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent-mission-control/postgrest')>(
    '@/lib/agent-mission-control/postgrest'
  )
  return { ...actual, pgrest }
})

const { evaluateReleaseGate } = await import('@/lib/agent-mission-control/release-gate')
const { runReplayComparison } = await import('@/lib/agent-mission-control/replay')
import type { ReplayOutcome } from '@/lib/agent-mission-control/replay'

const COPILOT = 'copilot-gate'
const CANDIDATE = 'ver-candidate'

type Row = Record<string, unknown>

/** The test/benchmark evidence the mock will (or won't) surface, given the filters. */
interface Evidence {
  versionId: string
  executionMode: 'live' | 'deterministic-fixture'
  passRate: number
  score: number
}
let testEvidence: Evidence | null
let benchEvidence: Evidence | null
/** Every GET path the gate issued — used to assert the query shape. */
const getPaths: string[] = []

const versionOf = (path: string) => path.match(/version_id=eq\.([^&]+)/)?.[1]
const wantsLive = (path: string) => path.includes('execution_mode=eq.live')

/** Does a stored evidence survive the query's version_id + execution_mode filters? */
function surfaces(ev: Evidence | null, path: string): boolean {
  if (!ev) return false
  if (versionOf(path) !== ev.versionId) return false
  if (wantsLive(path) && ev.executionMode !== 'live') return false
  return true
}

function installPgrest() {
  pgrest.mockImplementation(async (method: string, path: string) => {
    if (method === 'GET') getPaths.push(path)
    if (path.startsWith('copilots?')) {
      return [{ id: COPILOT, production_version_id: null, latest_version_id: CANDIDATE }]
    }
    if (path.startsWith('copilot_versions?')) return [{ id: CANDIDATE, label: 'v2', stage: 'draft' }]
    if (path.startsWith('improvement_proposals?')) return [] // no open cycle → pass
    if (path.startsWith('tools?')) return [{ name: 'count_words', risk_level: 'low' }]
    if (path.startsWith('test_runs?')) return surfaces(testEvidence, path) ? [{ id: 'trun', pass_rate: testEvidence!.passRate }] : []
    if (path.startsWith('test_results?')) {
      // Mirror the run's pass rate: one pass row per point of pass_rate=1, else a fail.
      return testEvidence && testEvidence.passRate >= 1 ? [{ status: 'pass', failure_reason: null }] : [{ status: 'fail', failure_reason: 'x' }]
    }
    if (path.startsWith('benchmark_runs?')) return surfaces(benchEvidence, path) ? [{ id: 'brun' }] : []
    if (path.startsWith('benchmark_results?')) {
      return benchEvidence
        ? [{ score: benchEvidence.score, accuracy: 1, task_success_rate: 1, unsafe_action_count: 0, confirmation_mistake_count: 0 }]
        : []
    }
    return []
  })
}

beforeEach(() => {
  pgrest.mockReset()
  getPaths.length = 0
  testEvidence = { versionId: CANDIDATE, executionMode: 'live', passRate: 1, score: 90 }
  benchEvidence = { versionId: CANDIDATE, executionMode: 'live', passRate: 1, score: 90 }
  installPgrest()
})

describe('release gate — fixture evidence never satisfies a production promotion (point 6)', () => {
  it('the gate queries test_runs AND benchmark_runs with execution_mode=eq.live', async () => {
    await evaluateReleaseGate(COPILOT, CANDIDATE)
    expect(getPaths.some((p) => p.startsWith('test_runs?') && wantsLive(p))).toBe(true)
    expect(getPaths.some((p) => p.startsWith('benchmark_runs?') && wantsLive(p))).toBe(true)
  })

  it('a LIVE candidate with clean evidence is promotable (positive control)', async () => {
    const gate = await evaluateReleaseGate(COPILOT, CANDIDATE)
    expect(gate?.checks.find((c) => c.id === 'tests-pass')?.status).toBe('pass')
    expect(gate?.checks.find((c) => c.id === 'benchmark-exists')?.status).toBe('pass')
    expect(gate?.promotable).toBe(true)
  })

  it('the SAME evidence, but fixture-backed, does NOT satisfy the gate', async () => {
    testEvidence = { versionId: CANDIDATE, executionMode: 'deterministic-fixture', passRate: 1, score: 90 }
    benchEvidence = { versionId: CANDIDATE, executionMode: 'deterministic-fixture', passRate: 1, score: 90 }
    const gate = await evaluateReleaseGate(COPILOT, CANDIDATE)
    expect(gate?.checks.find((c) => c.id === 'tests-pass')?.status).toBe('missing')
    expect(gate?.checks.find((c) => c.id === 'benchmark-exists')?.status).toBe('missing')
    expect(gate?.promotable).toBe(false)
  })
})

describe('release gate — evidence must be bound to the candidate version (point 11)', () => {
  it('a live run bound to ANOTHER version does not count for this candidate', async () => {
    testEvidence = { versionId: 'some-other-version', executionMode: 'live', passRate: 1, score: 90 }
    benchEvidence = { versionId: 'some-other-version', executionMode: 'live', passRate: 1, score: 90 }
    const gate = await evaluateReleaseGate(COPILOT, CANDIDATE)
    expect(gate?.checks.find((c) => c.id === 'tests-pass')?.status).toBe('missing')
    expect(gate?.promotable).toBe(false)
  })
})

describe('release gate — the latest completed run wins (point 14b: green supersedes red)', () => {
  it('reads the most recent run (order=started_at.desc, limit=1)', async () => {
    await evaluateReleaseGate(COPILOT, CANDIDATE)
    const testRunQuery = getPaths.find((p) => p.startsWith('test_runs?'))
    expect(testRunQuery).toMatch(/order=started_at\.desc/)
    expect(testRunQuery).toMatch(/limit=1/)
    // Given append-only runs (each re-run mints a new id — proven in the runners
    // test), reading the latest means a newer green run logically replaces an
    // older red one for the gate.
  })
})

describe('replay engine — a non-deterministic result is LABELLED, never hidden (point 10)', () => {
  it('two runs that differ only in output shape are tagged nondeterministic → INCONCLUSIVE', async () => {
    const base: ReplayOutcome = { ok: true, outputShape: '{a}', score: 0.9, toolsCalled: ['count_words'], unsafeActions: 0, latencyMs: 5, costUsd: 0 }
    const record = await runReplayComparison({
      copilotId: COPILOT,
      referenceVersionId: 'ref',
      candidateVersionId: CANDIDATE,
      inputs: [{ text: 'x' }],
      runReference: async () => ({ ...base, outputShape: '{a}' }),
      // Same ok/score/safety, DIFFERENT shape → a non-deterministic wobble.
      runCandidate: async () => ({ ...base, outputShape: '{b}' }),
      now: () => new Date('2026-07-25T00:00:00.000Z'),
    })
    expect(record.cases[0].comparison).toBe('nondeterministic')
    expect(record.verdict).toBe('INCONCLUSIVE')
  })
})
