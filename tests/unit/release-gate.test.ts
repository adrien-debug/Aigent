/**
 * Unit tests for evaluateReleaseGate (src/lib/agent-mission-control/release-gate.ts).
 *
 * Pure, offline: pgrest is mocked — no network, no gpu1 backend, no secrets.
 * Covers the promotion-critical checks the promotion route re-evaluates server-side.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReleaseGate } from '@/lib/agent-mission-control/release-gate'

const COPILOT_ID = 'copilot-gate-test'
const VERSION_ID = 'version-candidate-gate'
const PROD_VERSION_ID = 'version-prod-gate'
const TEST_RUN_ID = 'test-run-gate'
const BENCH_RUN_ID = 'bench-run-gate'
const PROD_BENCH_RUN_ID = 'bench-run-prod-gate'

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

function blockingLabels(gate: ReleaseGate): string[] {
  return gate.checks.filter((c) => c.status !== 'pass').map((c) => c.label)
}

interface GateMockConfig {
  copilotRow?: Record<string, unknown> | 'missing'
  versionRow?: Record<string, unknown> | 'missing'
  proposalRows?: Record<string, unknown>[]
  testRun?: { id: string; pass_rate: number } | null
  testResults?: Record<string, unknown>[]
  candidateBenchmarkRun?: { id: string } | null
  candidateBenchmarkResult?: Record<string, unknown> | null
  prodBenchmarkRun?: { id: string } | null
  prodBenchmarkResult?: Record<string, unknown> | null
  tools?: Record<string, unknown>[]
}

const defaultCopilot = {
  id: COPILOT_ID,
  production_version_id: null as string | null,
  latest_version_id: VERSION_ID,
}

const defaultVersion = {
  id: VERSION_ID,
  label: 'v0.2.0-draft',
  stage: 'draft',
}

const defaultBenchmarkResult = {
  score: 92,
  accuracy: 0.95,
  task_success_rate: 0.9,
  unsafe_action_count: 0,
  confirmation_mistake_count: 0,
}

function installGateMocks(config: GateMockConfig = {}) {
  const copilot =
    config.copilotRow === 'missing'
      ? null
      : { ...defaultCopilot, ...(config.copilotRow as Record<string, unknown> | undefined) }
  const version =
    config.versionRow === 'missing' ? null : { ...defaultVersion, ...(config.versionRow as Record<string, unknown> | undefined) }

  pgrestHandler = (_method, path) => {
    if (path.startsWith('copilots?')) {
      return copilot ? [copilot] : []
    }
    if (path.startsWith('copilot_versions?')) {
      return version ? [version] : []
    }
    if (path.startsWith('improvement_proposals?')) {
      return config.proposalRows ?? []
    }
    if (path.startsWith('test_runs?')) {
      if (config.testRun === null) return []
      return [config.testRun ?? { id: TEST_RUN_ID, pass_rate: 1 }]
    }
    if (path.startsWith('test_results?')) {
      return config.testResults ?? [{ status: 'pass', failure_reason: null }]
    }
    if (path.startsWith('benchmark_runs?')) {
      const encodedCandidate = encodeURIComponent(VERSION_ID)
      if (path.includes(`version_id=eq.${encodedCandidate}`)) {
        if (config.candidateBenchmarkRun === null) return []
        return [config.candidateBenchmarkRun ?? { id: BENCH_RUN_ID }]
      }
      const prodVersionId =
        (copilot?.production_version_id as string | null) ?? PROD_VERSION_ID
      if (prodVersionId && path.includes(`version_id=eq.${encodeURIComponent(prodVersionId)}`)) {
        if (config.prodBenchmarkRun === null) return []
        return [config.prodBenchmarkRun ?? { id: PROD_BENCH_RUN_ID }]
      }
      return []
    }
    if (path.startsWith('benchmark_results?')) {
      const encodedBench = encodeURIComponent(BENCH_RUN_ID)
      const encodedProdBench = encodeURIComponent(PROD_BENCH_RUN_ID)
      if (path.includes(`run_id=eq.${encodedBench}`)) {
        if (config.candidateBenchmarkResult === null) return []
        return [config.candidateBenchmarkResult ?? defaultBenchmarkResult]
      }
      if (path.includes(`run_id=eq.${encodedProdBench}`)) {
        if (config.prodBenchmarkResult === null) return []
        return [config.prodBenchmarkResult ?? { score: 90 }]
      }
      return []
    }
    if (path.startsWith('tools?')) {
      return config.tools ?? [{ name: 'read_repo_file', risk_level: 'low' }]
    }
    throw new Error(`Unmocked pgrest path: ${path}`)
  }
}

describe('evaluateReleaseGate', () => {
  beforeEach(() => {
    installGateMocks()
  })

  it('A — tests pass rate below 100% blocks promotion', async () => {
    installGateMocks({
      testRun: { id: TEST_RUN_ID, pass_rate: 0.66 },
      testResults: [
        { status: 'pass', failure_reason: null },
        { status: 'fail', failure_reason: 'missed expected behaviour' },
        { status: 'pass', failure_reason: null },
      ],
    })

    const gate = await evaluateReleaseGate(COPILOT_ID, VERSION_ID)
    expect(gate).not.toBeNull()
    expect(gate!.promotable).toBe(false)
    expect(check(gate!, 'tests-pass').status).toBe('fail')
    expect(blockingLabels(gate!)).toContain('Tests pass rate')
  })

  it('B — missing benchmark evidence blocks promotion', async () => {
    installGateMocks({
      candidateBenchmarkRun: null,
      candidateBenchmarkResult: null,
    })

    const gate = await evaluateReleaseGate(COPILOT_ID, VERSION_ID)
    expect(gate!.promotable).toBe(false)
    expect(check(gate!, 'benchmark-exists').status).toBe('missing')
    expect(blockingLabels(gate!)).toContain('Benchmark recorded')
  })

  it('C — unsafe actions in benchmark block promotion', async () => {
    installGateMocks({
      candidateBenchmarkResult: { ...defaultBenchmarkResult, unsafe_action_count: 2 },
    })

    const gate = await evaluateReleaseGate(COPILOT_ID, VERSION_ID)
    expect(gate!.promotable).toBe(false)
    expect(check(gate!, 'unsafe-actions').status).toBe('fail')
    expect(check(gate!, 'unsafe-actions').observed).toBe('2')
  })

  it('D — confirmation mistakes in benchmark block promotion', async () => {
    installGateMocks({
      candidateBenchmarkResult: { ...defaultBenchmarkResult, confirmation_mistake_count: 1 },
    })

    const gate = await evaluateReleaseGate(COPILOT_ID, VERSION_ID)
    expect(gate!.promotable).toBe(false)
    expect(check(gate!, 'confirmation-mistakes').status).toBe('fail')
    expect(check(gate!, 'confirmation-mistakes').observed).toBe('1')
  })

  it('E — GraphRecursionError in latest test run blocks promotion', async () => {
    installGateMocks({
      testRun: { id: TEST_RUN_ID, pass_rate: 1 },
      testResults: [
        {
          status: 'error',
          failure_reason:
            'Error: {"error":"GraphRecursionError","message":"Recursion limit of 25 reached without hitting a stop condition."}',
        },
      ],
    })

    const gate = await evaluateReleaseGate(COPILOT_ID, VERSION_ID)
    expect(gate!.promotable).toBe(false)
    expect(check(gate!, 'no-recursion').status).toBe('fail')
    expect(check(gate!, 'no-recursion').observed).toMatch(/GraphRecursionError/i)
    expect(blockingLabels(gate!)).toContain('No runtime recursion crash')
  })

  it.each(['proposed', 'v2-created'] as const)(
    'F — pending Improve cycle (%s) blocks promotion',
    async (status) => {
      installGateMocks({
        proposalRows: [{ id: 'improve-pending-1', status }],
      })

      const gate = await evaluateReleaseGate(COPILOT_ID, VERSION_ID)
      expect(gate!.promotable).toBe(false)
      expect(check(gate!, 'approved-cycle').status).toBe('fail')
      expect(check(gate!, 'approved-cycle').observed).toBe(status)
      expect(blockingLabels(gate!)).toContain('No undecided improvement cycle')
    }
  )

  it('G — no Improve cycle with green evidence is promotable', async () => {
    installGateMocks({ proposalRows: [] })

    const gate = await evaluateReleaseGate(COPILOT_ID, VERSION_ID)
    expect(gate).not.toBeNull()
    expect(gate!.promotable).toBe(true)
    expect(check(gate!, 'approved-cycle').status).toBe('pass')
    expect(check(gate!, 'approved-cycle').observed).toBe('no open cycle')
    expect(check(gate!, 'tests-pass').status).toBe('pass')
    expect(check(gate!, 'benchmark-exists').status).toBe('pass')
    expect(check(gate!, 'unsafe-actions').status).toBe('pass')
    expect(check(gate!, 'confirmation-mistakes').status).toBe('pass')
    expect(check(gate!, 'no-recursion').status).toBe('pass')
    expect(check(gate!, 'read-only-tools').status).toBe('pass')
    expect(check(gate!, 'is-draft').status).toBe('pass')
  })

  it('G — approved Improve cycle does not block promotion', async () => {
    installGateMocks({
      proposalRows: [{ id: 'improve-approved-1', status: 'approved' }],
    })

    const gate = await evaluateReleaseGate(COPILOT_ID, VERSION_ID)
    expect(gate!.promotable).toBe(true)
    expect(check(gate!, 'approved-cycle').status).toBe('pass')
  })

  it('H — candidate already in production stage blocks promotion', async () => {
    installGateMocks({
      versionRow: { id: VERSION_ID, label: 'v1.0.0', stage: 'production' },
    })

    const gate = await evaluateReleaseGate(COPILOT_ID, VERSION_ID)
    expect(gate!.promotable).toBe(false)
    expect(check(gate!, 'is-draft').status).toBe('fail')
    expect(check(gate!, 'is-draft').observed).toBe('production')
  })

  it('H — missing candidate version returns null', async () => {
    installGateMocks({ versionRow: 'missing' })

    const gate = await evaluateReleaseGate(COPILOT_ID, VERSION_ID)
    expect(gate).toBeNull()
  })

  it('H — missing copilot returns null', async () => {
    installGateMocks({ copilotRow: 'missing' })

    const gate = await evaluateReleaseGate(COPILOT_ID, VERSION_ID)
    expect(gate).toBeNull()
  })

  it('H — copilot without latest version and no explicit candidate returns null', async () => {
    installGateMocks({
      copilotRow: { id: COPILOT_ID, production_version_id: null, latest_version_id: null },
    })

    const gate = await evaluateReleaseGate(COPILOT_ID)
    expect(gate).toBeNull()
  })
})
