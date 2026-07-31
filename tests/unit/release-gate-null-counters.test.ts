/**
 * Unit tests for the "unmeasured counter is not a zero" invariant of
 * evaluateReleaseGate (src/lib/agent-mission-control/release-gate.ts).
 *
 * The defect these cover: `unsafe_action_count` / `confirmation_mistake_count`
 * were read with `?? 0`, so a SQL NULL — a counter that was NEVER MEASURED —
 * became the literal 0, which the check then read as "zero unsafe actions" and
 * turned into a `pass`. That is a fabricated green light on a promotion gate.
 * The `benchmark ? ... : 'missing'` ternary only ever protected the absence of a
 * ROW, never the absence of a VALUE.
 *
 * Product invariant (AGENTS.md): `active` means PROVEN — a completed run, ZERO
 * unsafe attempts, a verified model. An absent counter proves nothing, so it
 * must read `missing` (which blocks), never `pass` and never `fail`.
 *
 * Pure, offline: pgrest is mocked — no network, no gpu1 backend, no secrets.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReleaseGate } from '@/lib/agent-mission-control/release-gate'

const COPILOT_ID = 'copilot-null-counter'
const VERSION_ID = 'version-candidate-null-counter'
const TEST_RUN_ID = 'test-run-null-counter'
const BENCH_RUN_ID = 'bench-run-null-counter'

type PgrestHandler = (method: string, path: string) => unknown

let pgrestHandler: PgrestHandler

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async (method: string, path: string) => pgrestHandler(method, path)),
}))

import { evaluateReleaseGate } from '@/lib/agent-mission-control/release-gate'

function check(gate: ReleaseGate, id: string) {
  const row = gate.checks.find((c) => c.id === id)
  if (!row) throw new Error(`check "${id}" not found`)
  return row
}

/**
 * Everything is green EXCEPT what the caller overrides on the benchmark result
 * row — so any non-pass check the test observes is caused by that override
 * alone, and `promotable` isolates the counter under test.
 */
function installMocks(benchmarkResult: Record<string, unknown>) {
  pgrestHandler = (_method, path) => {
    if (path.startsWith('copilots?')) {
      return [{ id: COPILOT_ID, production_version_id: null, latest_version_id: VERSION_ID }]
    }
    if (path.startsWith('copilot_versions?')) return [{ id: VERSION_ID, label: 'v0.2.0-draft', stage: 'draft' }]
    if (path.startsWith('improvement_proposals?')) return []
    if (path.startsWith('test_runs?')) return [{ id: TEST_RUN_ID, pass_rate: 1 }]
    if (path.startsWith('test_results?')) return [{ status: 'pass', failure_reason: null }]
    if (path.startsWith('benchmark_runs?')) return [{ id: BENCH_RUN_ID }]
    if (path.startsWith('benchmark_results?')) return [benchmarkResult]
    if (path.startsWith('tools?')) return [{ name: 'read_repo_file', risk_level: 'low' }]
    throw new Error(`Unmocked pgrest path: ${path}`)
  }
}

/** A fully measured, fully clean benchmark result row. */
const measuredClean = {
  score: 92,
  accuracy: 0.95,
  task_success_rate: 0.9,
  unsafe_action_count: 0,
  confirmation_mistake_count: 0,
}

async function gateWith(benchmarkResult: Record<string, unknown>): Promise<ReleaseGate> {
  installMocks(benchmarkResult)
  const gate = await evaluateReleaseGate(COPILOT_ID, VERSION_ID)
  if (!gate) throw new Error('evaluateReleaseGate returned null')
  return gate
}

describe('release gate — a counter that was never measured is not a zero', () => {
  beforeEach(() => {
    installMocks(measuredClean)
  })

  it('baseline: a fully measured clean benchmark is promotable (the mocks are otherwise green)', async () => {
    const gate = await gateWith(measuredClean)
    expect(check(gate, 'unsafe-actions').status).toBe('pass')
    expect(check(gate, 'confirmation-mistakes').status).toBe('pass')
    expect(gate.promotable).toBe(true)
  })

  describe('unsafe-actions', () => {
    it('unsafe_action_count NULL → missing, and promotion is BLOCKED', async () => {
      const gate = await gateWith({ ...measuredClean, unsafe_action_count: null })
      const row = check(gate, 'unsafe-actions')
      expect(row.status).toBe('missing')
      expect(row.status).not.toBe('pass')
      expect(row.observed).toBe('not measured')
      expect(gate.promotable).toBe(false)
      // The evidence keeps the null: nothing is coerced on the way out either.
      expect(gate.evidence.benchmark?.unsafeActionCount).toBeNull()
    })

    it('unsafe_action_count column entirely absent from the row → missing, BLOCKED', async () => {
      const row = { ...measuredClean } as Record<string, unknown>
      delete row.unsafe_action_count
      const gate = await gateWith(row)
      expect(check(gate, 'unsafe-actions').status).toBe('missing')
      expect(gate.promotable).toBe(false)
    })

    it('unsafe_action_count = 0 → pass', async () => {
      const gate = await gateWith({ ...measuredClean, unsafe_action_count: 0 })
      const row = check(gate, 'unsafe-actions')
      expect(row.status).toBe('pass')
      expect(row.observed).toBe('0')
      expect(gate.promotable).toBe(true)
    })

    it('unsafe_action_count = 3 → fail, and promotion is BLOCKED', async () => {
      const gate = await gateWith({ ...measuredClean, unsafe_action_count: 3 })
      const row = check(gate, 'unsafe-actions')
      expect(row.status).toBe('fail')
      expect(row.observed).toBe('3')
      expect(gate.promotable).toBe(false)
    })
  })

  describe('confirmation-mistakes', () => {
    it('confirmation_mistake_count NULL → missing, and promotion is BLOCKED', async () => {
      const gate = await gateWith({ ...measuredClean, confirmation_mistake_count: null })
      const row = check(gate, 'confirmation-mistakes')
      expect(row.status).toBe('missing')
      expect(row.status).not.toBe('pass')
      expect(row.observed).toBe('not measured')
      expect(gate.promotable).toBe(false)
      expect(gate.evidence.benchmark?.confirmationMistakeCount).toBeNull()
    })

    it('confirmation_mistake_count column entirely absent from the row → missing, BLOCKED', async () => {
      const row = { ...measuredClean } as Record<string, unknown>
      delete row.confirmation_mistake_count
      const gate = await gateWith(row)
      expect(check(gate, 'confirmation-mistakes').status).toBe('missing')
      expect(gate.promotable).toBe(false)
    })

    it('confirmation_mistake_count = 0 → pass', async () => {
      const gate = await gateWith({ ...measuredClean, confirmation_mistake_count: 0 })
      const row = check(gate, 'confirmation-mistakes')
      expect(row.status).toBe('pass')
      expect(row.observed).toBe('0')
      expect(gate.promotable).toBe(true)
    })

    it('confirmation_mistake_count = 3 → fail, and promotion is BLOCKED', async () => {
      const gate = await gateWith({ ...measuredClean, confirmation_mistake_count: 3 })
      const row = check(gate, 'confirmation-mistakes')
      expect(row.status).toBe('fail')
      expect(row.observed).toBe('3')
      expect(gate.promotable).toBe(false)
    })
  })

  describe('benchmark score', () => {
    it('score NULL → benchmark-exists and benchmark-not-worse are missing, never a 0/100 pass', async () => {
      const gate = await gateWith({ ...measuredClean, score: null })
      expect(check(gate, 'benchmark-exists').status).toBe('missing')
      expect(check(gate, 'benchmark-not-worse').status).toBe('missing')
      expect(gate.evidence.benchmark?.score).toBeNull()
      expect(gate.promotable).toBe(false)
    })

    it('score = 0 (measured, genuinely awful) is NOT missing — it is a real, reported value', async () => {
      const gate = await gateWith({ ...measuredClean, score: 0 })
      expect(check(gate, 'benchmark-exists').status).toBe('pass')
      expect(gate.evidence.benchmark?.score).toBe(0)
    })
  })

  it('aggregation: a `missing` check is never counted as a success', async () => {
    const gate = await gateWith({ ...measuredClean, unsafe_action_count: null })
    expect(gate.checks.some((c) => c.status === 'missing')).toBe(true)
    expect(gate.promotable).toBe(false)
  })
})
