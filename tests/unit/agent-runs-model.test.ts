/**
 * AIG-STABILIZATION-003 · C8 — the AgentRun read-model must surface the REAL
 * executed model (resolved_model / resolved_provider / model_unverified) and
 * NEVER invent one for a legacy run whose row predates those columns.
 *
 * Pure, OFFLINE: `pgrest` (the gpu1 PostgREST perimeter) is mocked at module
 * level, so `getRunsForCopilot` / `getRecentRuns` run their REAL snake→camel
 * mapping (`camelRow`) over in-memory rows. NO network, NO DB, NO secret.
 *
 * The invariants pinned here are the C2/C3 contract:
 *   1. a run row carrying the resolved columns surfaces them decamelised
 *      (resolved_model → resolvedModel, model_unverified → modelUnverified);
 *   2. a LEGACY run row that LACKS those columns (older than migration 0020)
 *      surfaces resolvedModel as ABSENT — the read-model never fabricates a
 *      model string — and is treated as UNVERIFIED, never presented as a fact;
 *   3. the mapping is a pure passthrough: it never guesses a provider/model
 *      from other fields (cost, latency, label) — absent stays absent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

type RawRow = Record<string, unknown>

let runRows: RawRow[] = []

vi.mock('@/lib/agent-mission-control/postgrest', async (importOriginal) => {
  // Keep the REAL camelRow / camelRows (the mapping under test); only the
  // network-touching `pgrest` is replaced with an in-memory stub.
  const actual = await importOriginal<typeof import('@/lib/agent-mission-control/postgrest')>()
  return {
    ...actual,
    pgrest: vi.fn(async (_method: string, _path: string) => runRows),
  }
})

import { getRunsForCopilot, getRecentRuns } from '@/lib/agent-mission-control/data'

// ---------------------------------------------------------------------------
// Row builders — snake_case, exactly as PostgREST returns `agent_runs?select=*`.
// ---------------------------------------------------------------------------

/** A run row AFTER migration 0020 — carries the three resolved columns. */
function resolvedRunRow(overrides: RawRow = {}): RawRow {
  return {
    id: 'run-new-01',
    copilot_id: 'copilot-atlas',
    version_id: 'ver-1',
    project_id: 'proj-1',
    user_label: 'nightly',
    started_at: '2026-07-18T10:00:00.000Z',
    finished_at: '2026-07-18T10:00:12.000Z',
    status: 'completed',
    input_summary: 'in',
    output_summary: 'out',
    tool_call_count: 2,
    unsafe_attempt_count: 0,
    latency_ms: 12000,
    cost_usd: '0.0123',
    trace_url: null,
    resolved_model: 'gpt-5.4',
    resolved_provider: 'openai',
    model_unverified: false,
    agent_run_steps: [{ id: 'step-1' }],
    ...overrides,
  }
}

/**
 * A LEGACY run row — written BEFORE migration 0020, so it simply has NO
 * resolved_* / model_unverified keys at all (not null keys — absent keys).
 */
function legacyRunRow(overrides: RawRow = {}): RawRow {
  return {
    id: 'run-legacy-01',
    copilot_id: 'copilot-atlas',
    version_id: 'ver-0',
    project_id: 'proj-1',
    user_label: 'old-run',
    started_at: '2026-01-01T00:00:00.000Z',
    finished_at: '2026-01-01T00:00:05.000Z',
    status: 'completed',
    input_summary: 'in',
    output_summary: 'out',
    tool_call_count: 1,
    unsafe_attempt_count: 0,
    latency_ms: 5000,
    cost_usd: '0.0040',
    trace_url: null,
    agent_run_steps: [],
    ...overrides,
  }
}

/** Typed view of the extra columns the read-model is expected to carry. */
type RunWithResolved = Awaited<ReturnType<typeof getRunsForCopilot>>[number] & {
  resolvedModel?: unknown
  resolvedProvider?: unknown
  modelUnverified?: unknown
}

afterEach(() => {
  runRows = []
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// (1) A resolved row surfaces the real executed model, decamelised.
// ---------------------------------------------------------------------------

describe('AgentRun read-model — resolved model surfaced', () => {
  it('maps resolved_model/resolved_provider/model_unverified onto the run', async () => {
    runRows = [resolvedRunRow()]
    const [run] = (await getRunsForCopilot('copilot-atlas')) as RunWithResolved[]
    expect(run?.resolvedModel).toBe('gpt-5.4')
    expect(run?.resolvedProvider).toBe('openai')
    expect(run?.modelUnverified).toBe(false)
    // Base run fields still map correctly (sanity that the row was decamelised).
    expect(run?.id).toBe('run-new-01')
    expect(run?.stepIds).toEqual(['step-1'])
    expect(run?.costUsd).toBe('0.0123')
  })

  it('a verified local run surfaces provider=local + its real model, verified', async () => {
    runRows = [
      resolvedRunRow({
        id: 'run-local-01',
        resolved_provider: 'local',
        resolved_model: 'local-llama-70b',
        model_unverified: false,
      }),
    ]
    const [run] = (await getRecentRuns()) as RunWithResolved[]
    expect(run?.resolvedProvider).toBe('local')
    expect(run?.resolvedModel).toBe('local-llama-70b')
    expect(run?.modelUnverified).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// (2) A legacy row is UNVERIFIED and never carries a fabricated model.
// ---------------------------------------------------------------------------

describe('AgentRun read-model — legacy runs stay honest (no invented model)', () => {
  it('a legacy row (no resolved columns) surfaces NO resolvedModel — not a guess', async () => {
    runRows = [legacyRunRow()]
    const [run] = (await getRunsForCopilot('copilot-atlas')) as RunWithResolved[]
    // Absent column stays absent — the read-model invents nothing.
    expect(run?.resolvedModel).toBeUndefined()
    expect(run?.resolvedProvider).toBeUndefined()
    // The UI must treat an unknown model as unverified, never as ground truth.
    // A legacy row carries no explicit `model_unverified:false`, so the value is
    // never the "verified" sentinel — it is undefined (unknown), i.e. NOT false.
    expect(run?.modelUnverified).not.toBe(false)
  })

  it('an explicit model_unverified:true row is surfaced as unverified', async () => {
    runRows = [
      resolvedRunRow({
        id: 'run-unverified-01',
        resolved_model: 'gpt-5.4',
        resolved_provider: 'openai',
        model_unverified: true,
      }),
    ]
    const [run] = (await getRunsForCopilot('copilot-atlas')) as RunWithResolved[]
    expect(run?.modelUnverified).toBe(true)
    // Even with a model string present, "unverified" must not be lost.
    expect(run?.resolvedModel).toBe('gpt-5.4')
  })

  it('never derives a model from cost/latency/label of a legacy row', async () => {
    runRows = [legacyRunRow({ cost_usd: '9.9999', latency_ms: 99999, user_label: 'gpt-5.4' })]
    const [run] = (await getRunsForCopilot('copilot-atlas')) as RunWithResolved[]
    // A tempting-but-wrong inference source (a label that looks like a model)
    // must NOT leak into resolvedModel.
    expect(run?.resolvedModel).toBeUndefined()
    expect(run?.userLabel).toBe('gpt-5.4') // proves the label was present…
    expect(run?.resolvedModel).not.toBe('gpt-5.4') // …and still not copied over
  })

  it('a mixed run set maps each row independently (legacy stays legacy)', async () => {
    runRows = [resolvedRunRow(), legacyRunRow()]
    const runs = (await getRecentRuns()) as RunWithResolved[]
    const byId = new Map(runs.map((r) => [r.id, r]))
    expect(byId.get('run-new-01')?.resolvedModel).toBe('gpt-5.4')
    expect(byId.get('run-new-01')?.modelUnverified).toBe(false)
    expect(byId.get('run-legacy-01')?.resolvedModel).toBeUndefined()
    expect(byId.get('run-legacy-01')?.modelUnverified).not.toBe(false)
  })
})
