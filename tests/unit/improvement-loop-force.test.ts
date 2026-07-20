/**
 * Regression tests for `runAutoImprovementCycle`'s `force` semantics.
 *
 * THE BUG (fixed in 22f145b): `createImprovementV2` moves
 * `copilots.latest_version_id` onto the new V2 BEFORE the loop compares it to
 * its base. Without `force`, the plateau branch returned early, so a degraded
 * V2 was left as head for a human to judge — one bad version, loop stopped.
 * With `force`, that early return was skipped but nothing rolled the head
 * back, so the degraded V2 silently became the NEXT iteration's base. Each
 * round then proposed on top of a worse agent and the copilot decayed
 * monotonically — the user-visible symptom being "the agent gets worse every
 * time I run auto-improve".
 *
 * `force` must mean "keep trying", NOT "accept a regression".
 *
 * These tests drive the REAL loop (control flow, plateau branch and rollback
 * are all genuine) against a stateful in-memory fake of the `pgrest` boundary.
 * Mocking at the module boundary rather than spying on the loop's own exports
 * matters: intra-module calls do not go through the ES module binding, so
 * `vi.spyOn(loop, 'analyzeAndPropose')` would not intercept them and the test
 * would silently exercise nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const COPILOT_ID = 'copilot-under-test'
const BASE_VERSION = 'ver-base-good'
const BASE_MANIFEST = 'man-base'
const SUITE_ID = 'suite-1'

/** V2 pass rate per iteration, set by each test. Base is pinned at 0.9. */
let v2PassRates: number[] = []
/** Version id created by each create-v2, in order. */
const createdVersionIds: string[] = []
/** Every `latest_version_id` written, in order — the assertion surface. */
const headWrites: string[] = []
/** Mutable head, exactly like the real `copilots.latest_version_id` column. */
let currentHead = BASE_VERSION

/**
 * Rows the loop POSTs and later reads back (proposals above all — create-v2
 * fetches the proposal it was handed by id). Keyed by table name.
 */
const inserted = new Map<string, Record<string, unknown>[]>()

/** Rows of `table` whose id matches `id=eq.<x>` in the url, if any. */
function insertedMatching(table: string, url: string): Record<string, unknown>[] {
  const rows = inserted.get(table) ?? []
  const id = /[?&]id=eq\.([^&]+)/.exec(url)?.[1]
  if (!id) return rows
  const wanted = decodeURIComponent(id)
  return rows.filter((r) => r.id === wanted)
}

function rowsFor(url: string): unknown[] {
  const table = url.split('?')[0]

  switch (table) {
    case 'copilots':
      return [
        {
          id: COPILOT_ID,
          slug: 'under-test',
          name: 'Under Test',
          model: 'gpt-5.4',
          model_provider: 'openai',
          status: 'active',
          latest_version_id: currentHead,
          production_version_id: BASE_VERSION,
        },
      ]

    case 'copilot_versions': {
      // The loop resolves its base from whatever the head currently points at.
      const id = /id=eq\.([^&]+)/.exec(url)?.[1]
      const versionId = id ? decodeURIComponent(id) : currentHead
      return [
        {
          id: versionId,
          copilot_id: COPILOT_ID,
          label: versionId,
          stage: 'draft',
          manifest_id: BASE_MANIFEST,
          model: 'gpt-5.4',
          model_provider: 'openai',
          scores: { testPassRate: 0.9, benchmarkScore: 90, shadowAgreement: null, unsafeActionCount: 0 },
        },
      ]
    }

    case 'manifests':
      return [
        {
          id: BASE_MANIFEST,
          copilot_id: COPILOT_ID,
          version: 'v1',
          system_prompt_summary: 'Base prompt.',
          allowed_routes: [],
          forbidden_actions: ['leak secrets'],
          confirmation_policy: 'never',
          always_confirm_actions: [],
          memory_sources: [],
          output_contract: { invariants: ['stay in scope'] },
          skills: [],
          tool_ids: [],
          max_steps_per_run: 12,
          max_cost_per_run_usd: 1,
        },
      ]

    case 'test_suites':
      return [{ id: SUITE_ID, copilot_id: COPILOT_ID, name: 'suite' }]

    case 'test_cases':
      return [{ id: 'tc-1', suite_id: SUITE_ID, name: 'case 1', expected_behavior: 'do the thing' }]

    // Pass rates are read back from `test_runs` filtered by version_id — the
    // base always scores 0.9, each V2 scores whatever the test scripted. A
    // real failing case must exist too, otherwise analyze short-circuits on
    // "nothing to improve" and the plateau branch is never reached.
    case 'test_runs': {
      const versionId = decodeURIComponent(/version_id=eq\.([^&]+)/.exec(url)?.[1] ?? '')
      const v2Index = createdVersionIds.indexOf(versionId)
      const passRate = v2Index >= 0 ? v2PassRates[Math.min(v2Index, v2PassRates.length - 1)] : 0.9
      return [
        {
          id: `run-${versionId}`,
          suite_id: SUITE_ID,
          version_id: versionId,
          status: 'completed',
          pass_rate: passRate,
          finished_at: '2026-07-20T00:00:00.000Z',
        },
      ]
    }

    case 'test_results':
      return [
        {
          id: 'tcr-1',
          run_id: `run-${currentHead}`,
          case_id: 'tc-1',
          status: 'fail',
          failure_reason: 'did not do the thing',
          actual_behavior: 'nothing happened',
          actual_tool_calls: [],
        },
      ]

    default:
      // benchmark_suites / benchmark_runs / proposals / telemetry: empty is a
      // valid, meaningful state for all of them here.
      return []
  }
}

const pgrestMock = vi.fn(async (method: string, url: string, body?: unknown) => {
  const table = url.split('?')[0]

  if (method === 'GET') {
    // Anything the loop wrote this run wins over the static fixture — the
    // proposal create-v2 reads back by id only exists because analyze POSTed it.
    if (inserted.has(table)) {
      const hits = insertedMatching(table, url)
      if (hits.length > 0) return hits
    }
    return rowsFor(url)
  }

  if (method === 'POST') {
    const row = (body ?? {}) as Record<string, unknown>
    const bucket = inserted.get(table)
    if (bucket) bucket.push(row)
    else inserted.set(table, [row])
    if (table === 'copilot_versions' && typeof row.id === 'string') {
      createdVersionIds.push(row.id)
    }
    return [row]
  }

  if (method === 'PATCH') {
    const row = (body ?? {}) as Record<string, unknown>
    if (table === 'copilots' && typeof row.latest_version_id === 'string') {
      headWrites.push(row.latest_version_id)
      currentHead = row.latest_version_id // mirror the real column
      return []
    }

    // Everything else updates stored rows in place and returns them, like
    // PostgREST with `return=representation`. create-v2 claims its proposal
    // with a conditional PATCH (`&status=eq.proposed`) and treats an empty
    // response as "already claimed" — so the filter has to be honoured.
    const rows = inserted.get(table) ?? []
    const idMatch = /[?&]id=eq\.([^&]+)/.exec(url)?.[1]
    const wantedId = idMatch ? decodeURIComponent(idMatch) : null
    const statusMatch = /[?&]status=eq\.([^&]+)/.exec(url)?.[1]
    const wantedStatus = statusMatch ? decodeURIComponent(statusMatch) : null

    const hits = rows.filter(
      (r) => (wantedId === null || r.id === wantedId) && (wantedStatus === null || r.status === wantedStatus)
    )
    for (const hit of hits) Object.assign(hit, row)
    return hits
  }

  return []
})

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: (...args: unknown[]) => pgrestMock(...(args as [string, string, unknown?])),
}))

// The proposer LLM: always returns one valid manifest change so every
// iteration produces a materializable V2.
vi.mock('@/lib/agent-mission-control/model-router', () => ({
  routeCompletion: vi.fn(async () => ({
    text: JSON.stringify({
      summary: 'Tighten the system prompt.',
      expectedImpact: 'Should fix case 1.',
      manifestChanges: { systemPromptSummary: { to: 'Base prompt. Now stricter.' } },
      failureAnalysis: [{ caseName: 'case 1', rootCause: 'too loose', evidence: 'observed' }],
    }),
    costUsd: 0.01,
  })),
}))

// Re-running the V2 produces the scripted pass rate for this iteration.
vi.mock('@/lib/agent-mission-control/test-runner', () => ({
  runTestSuite: vi.fn(async () => {
    const idx = Math.min(createdVersionIds.length, v2PassRates.length) - 1
    return { passRate: v2PassRates[Math.max(0, idx)] }
  }),
}))

vi.mock('@/lib/agent-mission-control/benchmark-runner', () => ({
  runBenchmarkSuite: vi.fn(async () => ({ score: 0 })),
}))
vi.mock('@/lib/agent-mission-control/langgraph-assistants', () => ({
  ensureCopilotAssistant: vi.fn(),
}))
vi.mock('@/lib/agent-mission-control/langgraph-explorer', () => ({
  getThreadDetail: vi.fn(async () => null),
}))
vi.mock('@/lib/agent-mission-control/runtime-telemetry-store', () => ({
  summarizeRuntimeTelemetry: vi.fn(async () => null),
}))

import { runAutoImprovementCycle } from '@/lib/agent-mission-control/improvement-loop'

describe('runAutoImprovementCycle — force must not adopt regressions', () => {
  beforeEach(() => {
    v2PassRates = []
    createdVersionIds.length = 0
    headWrites.length = 0
    currentHead = BASE_VERSION
    inserted.clear()
    pgrestMock.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('restores the head to the base version when a forced V2 does not improve', async () => {
    v2PassRates = [0.5]

    await runAutoImprovementCycle(COPILOT_ID, { maxIterations: 1, force: true })

    // create-v2 moved the head onto the degraded V2 — the fix must move it back.
    expect(createdVersionIds).toHaveLength(1)
    expect(headWrites).toContain(createdVersionIds[0])
    expect(headWrites.at(-1)).toBe(BASE_VERSION)
    expect(currentHead).toBe(BASE_VERSION)
  })

  it('never leaves a degraded version as the head across repeated regressions', async () => {
    // Three consecutive regressions — the decay scenario the user reported.
    v2PassRates = [0.5, 0.4, 0.3]

    await runAutoImprovementCycle(COPILOT_ID, { maxIterations: 3, force: true })

    expect(createdVersionIds.length).toBeGreaterThan(1)
    // Every degraded V2 got rolled back; the good base survives the whole run.
    expect(currentHead).toBe(BASE_VERSION)
    for (const created of createdVersionIds) {
      expect(created).not.toBe(currentHead)
    }
  })

  it('keeps a forced V2 that genuinely improves', async () => {
    v2PassRates = [0.95]

    await runAutoImprovementCycle(COPILOT_ID, { maxIterations: 1, force: true })

    // An improving V2 is the new base: no rollback, head stays on the V2.
    expect(createdVersionIds).toHaveLength(1)
    expect(currentHead).toBe(createdVersionIds[0])
    expect(headWrites.at(-1)).toBe(createdVersionIds[0])
  })

  it('without force, a non-improving V2 stops the loop and stays as head', async () => {
    v2PassRates = [0.5, 0.4]

    const result = await runAutoImprovementCycle(COPILOT_ID, { maxIterations: 2, force: false })

    expect(result.stoppedBy).toBe('plateau')
    expect(result.iterations).toBe(1)
    // Unforced behaviour is unchanged: head stays on the V2 for a human call.
    expect(currentHead).toBe(createdVersionIds[0])
  })
})
