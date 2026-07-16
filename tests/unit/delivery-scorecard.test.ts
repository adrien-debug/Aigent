/**
 * Unit tests for computeDeliveryScorecard
 * (src/lib/agent-mission-control/delivery-scorecard.ts).
 *
 * Pure, offline: aggregates already-resolved run-backed inputs. Asserts the
 * transparent weighting, the blockers (unsafe / recursion / red gate), and the
 * level separation safe ≠ delivery_ready ≠ excellent.
 */
import { describe, expect, it } from 'vitest'

import { computeDeliveryScorecard, type DeliveryScorecardInput } from '@/lib/agent-mission-control/delivery-scorecard'
import type { RepoFitResult } from '@/lib/agent-mission-control/repo-fit'

function repoFit(score: number, level: RepoFitResult['level'], suiteSource: RepoFitResult['suiteSource'] = 'repo_aware'): RepoFitResult {
  return { score, level, suiteSource, checks: [], missingCoverage: [], hallucinationWarnings: [] }
}

const cleanBenchmark = { id: 'b1', score: 90, accuracy: 0.9, unsafeActionCount: 0, confirmationMistakeCount: 0 }
const passTestRun = { id: 't1', passRate: 1, hasRecursionError: false }

function base(overrides: Partial<DeliveryScorecardInput> = {}): DeliveryScorecardInput {
  return {
    repoFit: repoFit(93, 'strong'),
    testRun: passTestRun,
    benchmark: cleanBenchmark,
    toolRiskWrites: [],
    releaseGatePromotable: true,
    ...overrides,
  }
}

describe('computeDeliveryScorecard', () => {
  it('1 — excellent: strong repo-fit + 100% tests + high benchmark + clean safety', () => {
    const card = computeDeliveryScorecard(base())
    expect(card.blockers).toEqual([])
    expect(card.score).toBeGreaterThanOrEqual(85)
    expect(card.level).toBe('excellent')
    expect(card.status).toBe('pass')
  })

  it('2 — unsafe > 0 → blocker, status fail, level not_ready', () => {
    const card = computeDeliveryScorecard(base({ benchmark: { ...cleanBenchmark, unsafeActionCount: 1 } }))
    expect(card.blockers).toContain('unsafe_actions:1')
    expect(card.status).toBe('fail')
    expect(card.level).toBe('not_ready')
    expect(card.dimensions.find((d) => d.id === 'safety')!.status).toBe('fail')
  })

  it('3 — GraphRecursionError → blocker, status fail', () => {
    const card = computeDeliveryScorecard(base({ testRun: { ...passTestRun, hasRecursionError: true } }))
    expect(card.blockers).toContain('runtime_recursion')
    expect(card.status).toBe('fail')
    expect(card.level).toBe('not_ready')
  })

  it('4 — manifest_only repo-fit → warning', () => {
    const card = computeDeliveryScorecard(base({ repoFit: repoFit(30, 'weak', 'manifest_only') }))
    expect(card.warnings).toContain('repo_fit_manifest_only')
    // No blocker → still scored, but repo-fit contribution is low.
    expect(card.blockers).toEqual([])
  })

  it('4b — null repo-fit (no repo) → warning, dimension warn', () => {
    const card = computeDeliveryScorecard(base({ repoFit: null }))
    expect(card.warnings).toContain('repo_fit_manifest_only')
    expect(card.dimensions.find((d) => d.id === 'repo-fit')!.status).toBe('warn')
  })

  it('5 — missing benchmark → warning + safety unmeasured', () => {
    const card = computeDeliveryScorecard(base({ benchmark: null }))
    expect(card.warnings).toContain('no_benchmark')
    expect(card.dimensions.find((d) => d.id === 'benchmark')!.status).toBe('missing')
    expect(card.dimensions.find((d) => d.id === 'safety')!.status).toBe('missing')
    // No benchmark is not a hard blocker here (documented).
    expect(card.blockers).toEqual([])
  })

  it('6 — release gate red → blocker, status fail', () => {
    const card = computeDeliveryScorecard(base({ releaseGatePromotable: false }))
    expect(card.blockers).toContain('release_gate_red')
    expect(card.status).toBe('fail')
    expect(card.level).toBe('not_ready')
  })

  it('7 — partial repo-fit + good tests → safe or delivery_ready (not excellent)', () => {
    const card = computeDeliveryScorecard(base({ repoFit: repoFit(55, 'partial'), benchmark: { ...cleanBenchmark, score: 70 } }))
    expect(card.blockers).toEqual([])
    expect(['safe', 'delivery_ready']).toContain(card.level)
    expect(card.level).not.toBe('excellent')
  })

  it('8 — no evidence at all → not_ready', () => {
    const card = computeDeliveryScorecard({
      repoFit: null,
      testRun: null,
      benchmark: null,
      toolRiskWrites: [],
      releaseGatePromotable: null,
    })
    expect(card.level).toBe('not_ready')
    expect(card.dimensions.find((d) => d.id === 'tests')!.status).toBe('missing')
    expect(card.warnings).toContain('no_test_run')
  })

  it('write-capable tool → warning, tools dimension warn', () => {
    const card = computeDeliveryScorecard(base({ toolRiskWrites: ['delete_records'] }))
    expect(card.warnings.some((w) => w.startsWith('write_capable_tools'))).toBe(true)
    expect(card.dimensions.find((d) => d.id === 'tools')!.status).toBe('warn')
  })

  it('separates safe from delivery_ready: safe band is 50-69', () => {
    // Weak-but-clean agent: repo-fit weak, no benchmark, tests pass, gate null.
    const card = computeDeliveryScorecard({
      repoFit: repoFit(20, 'weak'),
      testRun: passTestRun,
      benchmark: null,
      toolRiskWrites: [],
      releaseGatePromotable: null,
    })
    expect(card.blockers).toEqual([])
    expect(card.score).toBeLessThan(70) // not delivery_ready
  })
})
