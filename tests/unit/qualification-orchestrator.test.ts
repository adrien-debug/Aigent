/**
 * AIGENT-AUTONOMOUS-FACTORY-001 — qualification orchestrator invariants.
 *
 * DETERMINISTIC + OFFLINE: pgrest is a small in-memory fake, the promotion gate
 * is mocked (its own tests prove it), and NO provider call is made. Each mandatory
 * scenario proves the orchestrator's contract: honest statuses, version-scoping,
 * idempotency, resumability, candidate-mutation + archival detection, IDOR, no
 * lying READY, and no auto-promotion.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Everything the hoisted vi.mock factories need must itself be hoisted, or it hits
// a TDZ when the mocked module is imported (imports run before top-level consts).
const h = vi.hoisted(() => {
  class FakePgrestError extends Error {
    status: number
    constructor(status: number) {
      super(`PostgREST ${status}`)
      this.name = 'PgrestError'
      this.status = status
    }
  }

  type Row = Record<string, unknown>
  const state: { db: Record<string, Row[]> } = { db: {} }
  const gate: { outcome: { overall: string; promotable: boolean; checks: Array<{ label: string; status: string; reason: string }> } | null } = { outcome: null }
  const pgCalls: Array<{ method: string; path: string; body?: unknown }> = []

  function parse(path: string) {
    const [table, qs = ''] = path.split('?')
    const eq: Record<string, string> = {}
    let order: string | undefined
    let limit: number | undefined
    let inFilter: { col: string; ids: string[] } | undefined
    for (const seg of qs.split('&').filter(Boolean)) {
      const idx = seg.indexOf('=')
      const key = seg.slice(0, idx)
      const val = seg.slice(idx + 1)
      if (key === 'select') continue
      if (key === 'order') order = val
      else if (key === 'limit') limit = Number(val)
      else if (val.startsWith('eq.')) eq[key] = decodeURIComponent(val.slice(3))
      else if (val.startsWith('in.(')) {
        const inner = decodeURIComponent(val.slice(4, -1))
        inFilter = { col: key, ids: inner.split(',').map((s) => s.replace(/^"|"$/g, '')) }
      }
    }
    return { table, eq, inFilter, order, limit }
  }
  function matches(row: Row, eq: Record<string, string>, inFilter?: { col: string; ids: string[] }) {
    for (const [k, v] of Object.entries(eq)) if (String(row[k] ?? '') !== v) return false
    if (inFilter && !inFilter.ids.includes(String(row[inFilter.col] ?? ''))) return false
    return true
  }

  async function pgrest(method: string, path: string, body?: unknown): Promise<unknown> {
    pgCalls.push({ method, path, body })
    const { table, eq, inFilter, order, limit } = parse(path)
    const db = state.db
    db[table] ??= []
    if (method === 'GET') {
      let rows = db[table].filter((r) => matches(r, eq, inFilter))
      if (order) {
        const [col, dir] = order.split('.')
        rows = [...rows].sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')) * (dir === 'desc' ? -1 : 1))
      }
      if (limit !== undefined) rows = rows.slice(0, limit)
      return rows
    }
    if (method === 'POST') {
      const rows = Array.isArray(body) ? (body as Row[]) : [body as Row]
      if (table === 'qualification_runs') {
        for (const r of rows) {
          if (r.client_run_id != null && db[table].some((x) => x.copilot_id === r.copilot_id && x.client_run_id === r.client_run_id)) throw new FakePgrestError(409)
          if (r.status === 'running' && db[table].some((x) => x.copilot_version_id === r.copilot_version_id && x.status === 'running')) throw new FakePgrestError(409)
        }
      }
      db[table].push(...rows.map((r) => ({ ...r })))
      return rows
    }
    if (method === 'PATCH') {
      const target = db[table].filter((r) => matches(r, eq, inFilter))
      for (const r of target) Object.assign(r, body as Row)
      return target
    }
    if (method === 'DELETE') {
      db[table] = db[table].filter((r) => !matches(r, eq, inFilter))
      return []
    }
    return []
  }

  const evaluateAndPersistPromotionGate = vi.fn(async () =>
    gate.outcome ? { result: gate.outcome, gateEvaluationId: 'gate-eval-1' } : null,
  )

  return { FakePgrestError, state, gate, pgCalls, pgrest, evaluateAndPersistPromotionGate }
})

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: (m: string, p: string, b?: unknown) => h.pgrest(m, p, b),
  PgrestError: h.FakePgrestError,
}))
vi.mock('@/lib/agent-mission-control/promotion-gate', () => ({
  evaluateAndPersistPromotionGate: h.evaluateAndPersistPromotionGate,
  DEFAULT_PROMOTION_POLICY: { requireShadow: false, requireReplay: false },
}))

import {
  advanceQualification,
  computeReadiness,
  describeCandidate,
  getLatestQualificationRun,
  resolveCandidateTools,
  runQualificationSweep,
  startQualification,
} from '@/lib/agent-mission-control/qualification-orchestrator'

type Row = Record<string, unknown>
const COPILOT = 'copilot-a'
const VERSION = 'version-a'
const MANIFEST = 'manifest-a'
const CERTIFIED_TOOL_NAME = 'read_repo_file' // a real certified registry tool
const FakePgrestError = h.FakePgrestError
const pgCalls = h.pgCalls

let db: Record<string, Row[]>
function seed(overrides: { runtime?: string; toolIds?: string[]; stage?: string; toolRows?: Row[] } = {}) {
  const toolIds = overrides.toolIds ?? ['tool-1']
  db = {
    copilots: [{ id: COPILOT, runtime: overrides.runtime ?? 'langgraph', latest_version_id: VERSION, assistant_id: 'asst-1', production_version_id: null }],
    copilot_versions: [{ id: VERSION, copilot_id: COPILOT, stage: overrides.stage ?? 'draft', model: 'gpt-5.4', model_provider: 'openai', manifest_id: MANIFEST }],
    manifests: [{ id: MANIFEST, system_prompt_summary: 'do things', forbidden_actions: [], allowed_routes: [], output_contract: { format: 'json' }, confirmation_policy: 'risky-only', always_confirm_actions: [], max_steps_per_run: 10, max_cost_per_run_usd: 1, tool_ids: toolIds }],
    tools: overrides.toolRows ?? [{ id: 'tool-1', name: CERTIFIED_TOOL_NAME }],
    test_runs: [],
    test_results: [],
    benchmark_runs: [],
    benchmark_results: [],
    shadow_experiments: [],
    replay_comparisons: [],
    qualification_runs: [],
  }
  h.state.db = db
}

/** Monotonically increasing clock so created_at ordering is deterministic. */
function makeNow() {
  let t = Date.parse('2026-07-25T00:00:00.000Z')
  return () => new Date((t += 1000))
}

beforeEach(() => {
  pgCalls.length = 0
  h.gate.outcome = { overall: 'PASS', promotable: true, checks: [{ label: 'Controlled release gate', status: 'PASS', reason: 'ok' }] }
  h.evaluateAndPersistPromotionGate.mockClear()
  seed()
})

// #12 — ownership / IDOR
describe('IDOR / ownership (#12)', () => {
  it('refuses a version that belongs to a different copilot', async () => {
    db.copilot_versions[0].copilot_id = 'other-copilot'
    await expect(startQualification(COPILOT, VERSION, { now: makeNow() })).rejects.toMatchObject({ code: 'idor' })
  })
  it('404s a version that does not exist', async () => {
    await expect(startQualification(COPILOT, 'ghost', { now: makeNow() })).rejects.toMatchObject({ code: 'not_found' })
  })
})

// #3 phantom tool, #4 uncertified tool
describe('tool resolution + certification (#3, #4)', () => {
  it('flags a phantom tool id (declared, no tools row)', async () => {
    const report = await resolveCandidateTools(['tool-1', 'tool-ghost'])
    expect(report.phantom).toEqual(['tool-ghost'])
    expect(report.resolved).toBe(1)
  })
  it('flags an uncertified tool (row exists, not in certified registry)', async () => {
    db.tools.push({ id: 'tool-2', name: 'totally_unknown_tool' })
    const report = await resolveCandidateTools(['tool-1', 'tool-2'])
    expect(report.uncertified).toEqual(['totally_unknown_tool'])
    expect(report.certified).toBe(1)
  })
})

// #2 runtime invalid — the contract reports runtime executability honestly
describe('runtime executability in the creation contract (#2)', () => {
  it('marks a non-executable runtime as not executable', async () => {
    seed({ runtime: 'openai-assistants' })
    const contract = await describeCandidate(COPILOT)
    expect(contract?.runtimeExecutable).toBe(false)
  })
  it('marks langgraph as executable', async () => {
    const contract = await describeCandidate(COPILOT)
    expect(contract?.runtimeExecutable).toBe(true)
  })
})

// #1 (contract) — a coherent candidate description
describe('creation contract (#1)', () => {
  it('describes a coherent candidate with resolved+certified tools and not-started qualification', async () => {
    const contract = await describeCandidate(COPILOT)
    expect(contract).toMatchObject({ copilotId: COPILOT, candidateVersionId: VERSION, runtimeExecutable: true, assistantProvisioned: true })
    expect(contract?.tools).toMatchObject({ declared: 1, resolved: 1, certified: 1, phantom: [], uncertified: [] })
    expect(contract?.qualification.state).toBe('not_started')
  })
})

// #7 — double submission is idempotent
describe('double submission (#7)', () => {
  it('returns the same run for a repeated client_run_id', async () => {
    const now = makeNow()
    const a = await startQualification(COPILOT, VERSION, { clientRunId: 'key-1', now })
    const b = await startQualification(COPILOT, VERSION, { clientRunId: 'key-1', now })
    expect(b.id).toBe(a.id)
    expect(db.qualification_runs).toHaveLength(1)
  })
  it('returns the in-flight run when a keyless start races an existing one', async () => {
    const now = makeNow()
    const a = await startQualification(COPILOT, VERSION, { now })
    const b = await startQualification(COPILOT, VERSION, { now })
    expect(b.id).toBe(a.id)
    expect(db.qualification_runs).toHaveLength(1)
  })
})

// #14 — sweep never auto-promotes; #13 — no lying READY
describe('full sweep, no auto-promotion (#14) + honest readiness (#13)', () => {
  it('walks tests→gate, stops, and never writes status/stage or calls the promote RPC', async () => {
    db.test_runs.push({ id: 'tr-1', version_id: VERSION, status: 'completed', pass_rate: 1, started_at: '2026-07-25T00:00:00Z' })
    db.test_results.push({ run_id: 'tr-1', status: 'pass' })
    db.benchmark_runs.push({ id: 'br-1', version_id: VERSION, status: 'completed', started_at: '2026-07-25T00:00:00Z' })
    db.benchmark_results.push({ run_id: 'br-1', score: 90, unsafe_action_count: 0 })

    const run = await runQualificationSweep(COPILOT, VERSION, { now: makeNow() })
    expect(run.status).toBe('promotable')
    expect(run.stepCursor).toBe('done')
    const steps = Object.fromEntries(run.steps.map((s) => [s.step, s.status]))
    expect(steps).toMatchObject({ tests: 'PASS', benchmark: 'PASS', shadow: 'NOT_AVAILABLE', replay: 'NOT_AVAILABLE', gate: 'PASS' })

    expect(pgCalls.some((c) => c.path.includes('rpc/promote_copilot_version'))).toBe(false)
    expect(pgCalls.some((c) => c.method === 'PATCH' && c.path.startsWith('copilots'))).toBe(false)
    expect(pgCalls.some((c) => c.method === 'PATCH' && c.path.startsWith('copilot_versions'))).toBe(false)

    const readiness = computeReadiness(run)
    expect(readiness.promotable).toBe(true)
    expect(readiness.state).toBe('promotable')
    expect(readiness.nextAction).not.toMatch(/\bREADY\b/)
    expect(readiness.nextAction).toMatch(/promotion is permitted/i)
  })

  it('a failing gate yields state=blocked, promotable=false, and no READY (#13)', async () => {
    h.gate.outcome = { overall: 'FAIL', promotable: false, checks: [{ label: 'Tests', status: 'FAIL', reason: '2 failing' }] }
    const run = await runQualificationSweep(COPILOT, VERSION, { now: makeNow() })
    expect(run.status).toBe('blocked')
    const readiness = computeReadiness(run)
    expect(readiness.promotable).toBe(false)
    expect(readiness.state).toBe('blocked')
    expect(readiness.nextAction).not.toMatch(/\bREADY\b/)
  })
})

// #10 — evidence from another version never satisfies this candidate
describe('cross-version evidence is scoped (#10)', () => {
  it('does not read another version’s completed shadow evidence', async () => {
    db.shadow_experiments.push({ id: 'sh-B', copilot_id: COPILOT, candidate_version_id: 'version-B', status: 'completed', candidate_verdict: 'PASS', started_at: '2026-07-25T00:00:00Z' })
    const run = await runQualificationSweep(COPILOT, VERSION, { now: makeNow() })
    const shadow = run.steps.find((s) => s.step === 'shadow')
    expect(shadow?.status).toBe('NOT_AVAILABLE')
  })
})

// #9 — candidate mutation during the workflow
describe('candidate mutation resistance (#9)', () => {
  it('supersedes a run when the manifest changes mid-workflow', async () => {
    const now = makeNow()
    let run = await startQualification(COPILOT, VERSION, { now })
    run = await advanceQualification(run, { now }) // tests
    db.manifests[0].tool_ids = ['tool-1', 'tool-9']
    db.tools.push({ id: 'tool-9', name: 'new_tool' })
    run = await advanceQualification(run, { now })
    expect(run.status).toBe('superseded')
  })
})

// #11 — archival / deletion during the workflow
describe('archival / deletion mid-workflow (#11)', () => {
  it('aborts when the candidate is archived mid-workflow', async () => {
    const now = makeNow()
    let run = await startQualification(COPILOT, VERSION, { now })
    db.copilot_versions[0].stage = 'archived'
    run = await advanceQualification(run, { now })
    expect(run.status).toBe('aborted')
  })
  it('aborts when the candidate version is deleted mid-workflow', async () => {
    const now = makeNow()
    let run = await startQualification(COPILOT, VERSION, { now })
    db.copilot_versions = []
    h.state.db = db
    run = await advanceQualification(run, { now })
    expect(run.status).toBe('aborted')
  })
})

// #8 — resume after an infra failure
describe('resume after failure (#8)', () => {
  it('leaves the cursor untouched on a thrown step and resumes it', async () => {
    const now = makeNow()
    db.test_runs.push({ id: 'tr-1', version_id: VERSION, status: 'completed', pass_rate: 1, started_at: '2026-07-25T00:00:00Z' })
    db.test_results.push({ run_id: 'tr-1', status: 'pass' })
    let run = await startQualification(COPILOT, VERSION, { now })
    run = await advanceQualification(run, { now }) // tests → benchmark
    expect(run.stepCursor).toBe('benchmark')

    // Inject an infra failure on the benchmark read.
    const original = db.benchmark_runs
    Object.defineProperty(db, 'benchmark_runs', { get() { throw new FakePgrestError(502) }, configurable: true })
    await expect(advanceQualification(run, { now })).rejects.toBeInstanceOf(FakePgrestError)

    // Cursor unchanged — the CAS never ran; then resume works once the read is fixed.
    Object.defineProperty(db, 'benchmark_runs', { value: original, writable: true, configurable: true })
    const persisted = await getLatestQualificationRun(COPILOT, VERSION)
    expect(persisted?.stepCursor).toBe('benchmark')
    const resumed = await advanceQualification(persisted!, { now })
    expect(resumed.stepCursor).toBe('shadow')
  })
})

describe('start guards', () => {
  it('refuses to start on a production version', async () => {
    seed({ stage: 'production' })
    await expect(startQualification(COPILOT, VERSION, { now: makeNow() })).rejects.toMatchObject({ code: 'not_a_candidate' })
  })
})

describe('readiness never lies (#13)', () => {
  it('not_started is honest and not promotable', () => {
    const r = computeReadiness(null)
    expect(r.state).toBe('not_started')
    expect(r.promotable).toBe(false)
    expect(r.nextAction).not.toMatch(/\bREADY\b/)
  })
})
