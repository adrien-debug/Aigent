/**
 * AIGENT-DETERMINISTIC-EVIDENCE-001 — the 14 required scenarios, driven through
 * the REAL runTestSuite / runBenchmarkSuite with the injected deterministic
 * adapter. Persistence (pgrest) is mocked at the module boundary; the runners
 * themselves are exercised for real. NOTHING is inserted directly into the
 * result tables — every test_runs / test_results / benchmark_runs /
 * benchmark_results row is produced by the official runner from the fixture's
 * output. That is the whole point: the fixture removes the billed LLM call, not
 * the official persistence path.
 *
 * Scenarios 10 (non-deterministic labelled), 11 (wrong-version refused) and the
 * gate-rejects-fixture / green-supersedes-red rules live in
 * deterministic-evidence-gate.test.ts (they exercise the gate, not the runners).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pgrest = vi.fn()
vi.mock('@/lib/agent-mission-control/postgrest', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent-mission-control/postgrest')>(
    '@/lib/agent-mission-control/postgrest'
  )
  return { ...actual, pgrest }
})
vi.mock('@/lib/agent-mission-control/resolve-run-assistant', () => ({
  resolveRunAssistantFromRow: vi.fn(async () => 'assistant-under-test'),
}))

const { runTestSuite } = await import('@/lib/agent-mission-control/test-runner')
const { runBenchmarkSuite, NoRunnableTasksError } = await import('@/lib/agent-mission-control/benchmark-runner')
const { makeDeterministicEvidenceAdapter } = await import('@/lib/agent-mission-control/evidence/deterministic-adapter')
import type { FixtureScenario } from '@/lib/agent-mission-control/evidence/deterministic-adapter'

const COPILOT = 'copilot-de'
const SUITE = 'suite-de'
const BSUITE = 'bsuite-de'
const VERSION = 'ver-de'
const TEST_ENV = { NODE_ENV: 'test' }

type Row = Record<string, unknown>
type Case = { id: string; input: string; expected_behavior?: string; expected_tool_calls?: string[] }

let cases: Case[]
const posts: Record<string, Row[]> = {}
const patches: Record<string, Row[]> = {}

function tableOf(path: string): string {
  return path.split('?')[0]
}

function installPgrest() {
  pgrest.mockImplementation(async (method: string, path: string, body?: Row) => {
    if (method === 'POST') {
      const t = tableOf(path)
      ;(posts[t] ??= []).push(body ?? {})
      return [body ?? {}]
    }
    if (method === 'PATCH') {
      const t = tableOf(path)
      ;(patches[t] ??= []).push(body ?? {})
      return [body ?? {}] // echo so the runner can read pass_rate/status back
    }
    // GET
    if (path.startsWith('copilots?')) {
      return [
        {
          id: COPILOT,
          name: 'Determinism Agent',
          runtime: 'langgraph',
          model: 'gpt-5.4',
          model_provider: 'openai',
          project_id: 'proj',
          production_version_id: VERSION,
          latest_version_id: VERSION,
          assistant_id: 'assistant-under-test',
        },
      ]
    }
    if (path.startsWith('copilot_versions?')) return [{ id: VERSION, manifest_id: 'm1' }]
    if (path.startsWith('manifests?')) {
      return [
        {
          id: 'm1',
          max_steps_per_run: 4,
          system_prompt_summary: 'You count words.',
          tool_ids: ['count_words'],
          forbidden_actions: [],
          allowed_routes: [],
          always_confirm_actions: [],
        },
      ]
    }
    if (path.startsWith('test_suites?')) {
      // GET by id (ownership) vs GET by copilot_id (benchmark task source).
      return method === 'GET' ? [{ id: SUITE, copilot_id: COPILOT }] : []
    }
    if (path.startsWith('test_cases?')) {
      return cases.map((c) => ({
        id: c.id,
        suite_id: SUITE,
        name: c.id,
        input: c.input,
        expected_behavior: c.expected_behavior ?? '',
        expected_tool_calls: c.expected_tool_calls ?? [],
        tags: [],
      }))
    }
    if (path.startsWith('benchmark_suites?')) return [{ id: BSUITE, copilot_id: COPILOT, task_count: 10 }]
    if (path.startsWith('tools?')) return [{ id: 'count_words', name: 'count_words', requires_confirmation: false }]
    return []
  })
}

beforeEach(() => {
  pgrest.mockReset()
  for (const k of Object.keys(posts)) delete posts[k]
  for (const k of Object.keys(patches)) delete patches[k]
  installPgrest()
})

afterEach(() => vi.useRealTimers())

function fixtureFor(scenarios: FixtureScenario[]) {
  return makeDeterministicEvidenceAdapter({ scenarios, env: TEST_ENV })
}

/** The persisted test_results, keyed by case id. */
function resultsByCase(): Record<string, Row> {
  const out: Record<string, Row> = {}
  for (const r of posts['test_results'] ?? []) out[r.case_id as string] = r
  return out
}

// ---------------------------------------------------------------------------
// TEST RUNNER — scenarios 1..6, driven through the real runTestSuite.
// ---------------------------------------------------------------------------

describe('runTestSuite via the deterministic adapter — scenarios 1..6', () => {
  it('persists a full mixed suite with NO direct writes, labelled deterministic-fixture', async () => {
    cases = [
      { id: 'green-1', input: 'the quick brown fox', expected_behavior: 'reports the count' },
      { id: 'green-2', input: 'one two three', expected_behavior: 'reports the count' },
      { id: 'red-1', input: 'wrong answer', expected_behavior: 'reports the count' },
      { id: 'toolerr-1', input: 'boom', expected_behavior: 'reports the count' },
      { id: 'ghost-1', input: 'ghost input', expected_behavior: 'uses the tool', expected_tool_calls: ['ghost_tool'] },
      { id: 'uncert-1', input: 'uncertified input', expected_behavior: 'refuses' },
      { id: 'timeout-1', input: 'slow input', expected_behavior: 'reports the count' },
    ]
    const adapter = fixtureFor([
      { input: 'the quick brown fox', behavior: { kind: 'count-words' }, grade: { pass: true } }, // 1 green
      { input: 'one two three', behavior: { kind: 'count-words' }, grade: { pass: true } }, // 1 green
      { input: 'wrong answer', behavior: { kind: 'wrong-answer' }, grade: { pass: false, reason: 'wrong count' } }, // 2 red
      { input: 'boom', behavior: { kind: 'tool-error' }, grade: { pass: false, reason: 'tool failed' } }, // 3 tool error
      { input: 'ghost input', behavior: { kind: 'count-words' }, grade: { pass: true } }, // 4 ghost: judge pass, gate fails
      { input: 'uncertified input', behavior: { kind: 'uncertified-tool', toolName: 'unknown_uncertified_tool' }, grade: { pass: false } }, // 5 uncertified
      { input: 'slow input', behavior: { kind: 'timeout' }, grade: { pass: false } }, // 6 timeout
    ])

    const run = await runTestSuite({ copilotId: COPILOT, suiteId: SUITE, adapter })

    // No direct writes: the ONLY test_runs/test_results rows came from the runner.
    expect((posts['test_runs'] ?? []).length).toBe(1)
    expect((posts['test_results'] ?? []).length).toBe(7)
    // Provenance is stamped by the runner from the adapter label.
    expect(posts['test_runs'][0].execution_mode).toBe('deterministic-fixture')

    const r = resultsByCase()
    expect(r['green-1'].status).toBe('pass') // (1) green
    expect(r['green-2'].status).toBe('pass')
    expect(r['red-1'].status).toBe('fail') // (2) red
    expect(r['toolerr-1'].status).toBe('fail') // (3) tool error
    expect(r['toolerr-1'].actual_tool_calls).toEqual(['count_words'])
    expect(r['ghost-1'].status).toBe('fail') // (4) ghost tool: ground-truth gate overrides judge pass
    expect(String(r['ghost-1'].failure_reason)).toMatch(/ghost_tool/)
    expect(r['uncert-1'].status).toBe('fail') // (5) uncertified tool attempt, recorded
    expect(r['uncert-1'].actual_tool_calls).toEqual(['unknown_uncertified_tool'])
    expect(r['timeout-1'].status).toBe('error') // (6) timeout → honest error
    expect(String(r['timeout-1'].failure_reason)).toMatch(/timeout/i)

    // pass_rate = 2 pass / 7 evaluated, computed by the runner (never fabricated).
    expect(run.passRate).toBeCloseTo(2 / 7, 4)
    expect(patches['test_runs'][0].status).toBe('completed')
  })
})

// ---------------------------------------------------------------------------
// BENCHMARK — scenarios 7..9, driven through the real runBenchmarkSuite.
// ---------------------------------------------------------------------------

describe('runBenchmarkSuite via the deterministic adapter — scenarios 7..9', () => {
  it('(7) a clean benchmark scores high and persists a real benchmark_results row', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-25T00:00:00.000Z'))
    cases = [{ id: 'b1', input: 'alpha beta' }, { id: 'b2', input: 'gamma delta' }]
    const adapter = fixtureFor([
      { input: 'alpha beta', behavior: { kind: 'count-words' }, grade: { pass: true, accuracy: 1 } },
      { input: 'gamma delta', behavior: { kind: 'count-words' }, grade: { pass: true, accuracy: 1 } },
    ])

    await runBenchmarkSuite({ copilotId: COPILOT, suiteId: BSUITE, adapter })

    expect((posts['benchmark_runs'] ?? []).length).toBe(1)
    expect(posts['benchmark_runs'][0].execution_mode).toBe('deterministic-fixture')
    const result = (posts['benchmark_results'] ?? [])[0]
    expect(result).toBeDefined()
    expect(result.task_success_rate).toBe(1)
    expect(result.unsafe_action_count).toBe(0)
    expect(result.score as number).toBeGreaterThan(80)
  })

  it('(8) a failing benchmark scores markedly lower', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-25T00:00:00.000Z'))
    cases = [{ id: 'b1', input: 'alpha beta' }, { id: 'b2', input: 'gamma delta' }]
    const adapter = fixtureFor([
      { input: 'alpha beta', behavior: { kind: 'wrong-answer' }, grade: { pass: false, accuracy: 0 } },
      { input: 'gamma delta', behavior: { kind: 'wrong-answer' }, grade: { pass: false, accuracy: 0 } },
    ])

    await runBenchmarkSuite({ copilotId: COPILOT, suiteId: BSUITE, adapter })

    const result = (posts['benchmark_results'] ?? [])[0]
    expect(result.task_success_rate).toBe(0)
    expect(result.score as number).toBeLessThan(50)
  })

  it('(9) an absent benchmark corpus is refused (NoRunnableTasksError), no result row', async () => {
    cases = [] // copilot has no test cases → no benchmark tasks to source
    const adapter = fixtureFor([])
    await expect(runBenchmarkSuite({ copilotId: COPILOT, suiteId: BSUITE, adapter })).rejects.toBeInstanceOf(
      NoRunnableTasksError
    )
    expect((posts['benchmark_results'] ?? []).length).toBe(0)
    // The run was created then honestly finished 'aborted' — never faked completed.
    expect((patches['benchmark_runs'] ?? [])[0]?.status).toBe('aborted')
  })
})

// ---------------------------------------------------------------------------
// Cross-cutting — scenarios 13 (no secret) and 14 (versioned re-run).
// ---------------------------------------------------------------------------

describe('runTestSuite via the deterministic adapter — no secret, versioned re-run', () => {
  it('(13) no secret leaks into any persisted row — the fixture makes no billed call', async () => {
    const SECRET = 'sk-DETERMINISTIC-TEST-SECRET-9f3a'
    const prev = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = SECRET
    try {
      cases = [{ id: 'g1', input: 'red green blue' }]
      const adapter = fixtureFor([{ input: 'red green blue', behavior: { kind: 'count-words' }, grade: { pass: true } }])
      await runTestSuite({ copilotId: COPILOT, suiteId: SUITE, adapter })

      const everythingPersisted = JSON.stringify({ posts, patches })
      expect(everythingPersisted).not.toContain(SECRET)
      // And the run cost is an honest 0 — no provider was billed.
      expect(patches['test_runs'][0].total_cost_usd).toBe(0)
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = prev
    }
  })

  it('(14) a re-run is explicitly versioned — a NEW run id each time, never an overwrite', async () => {
    cases = [{ id: 'g1', input: 'alpha' }]
    const adapter = fixtureFor([{ input: 'alpha', behavior: { kind: 'count-words' }, grade: { pass: true } }])

    const first = await runTestSuite({ copilotId: COPILOT, suiteId: SUITE, adapter })
    const second = await runTestSuite({ copilotId: COPILOT, suiteId: SUITE, adapter })

    expect(first.id).not.toBe(second.id)
    const runIds = (posts['test_runs'] ?? []).map((r) => r.id)
    expect(new Set(runIds).size).toBe(2) // two distinct persisted runs
  })
})
