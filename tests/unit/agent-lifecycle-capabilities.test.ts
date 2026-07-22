/**
 * Unit tests for getAgentLifecycle (src/lib/agent-mission-control/agent-lifecycle.ts).
 *
 * AIGENT-OPERATOR-RESTORE-028. What this file defends is not "the eight buttons
 * render" — it is the four invariants that made the lifecycle surfaces safe to
 * bring back at all:
 *
 *   1. RUNTIME HONESTY — the capability tracks the ENGINE, never a slogan about
 *      it. Since AIGENT-RUNNER-RUNTIME-029 `test-runner.ts` branches: `langgraph`
 *      streams the Agent Server, `openai-assistants` runs `executeCopilotRun`,
 *      anything else raises `UnsupportedRuntimeError`. So "Run tests" is now
 *      honest on BOTH served runtimes and refuses elsewhere with that real
 *      motive. AIGENT-BENCH-RUNTIME-030 gave `benchmark-runner.ts` the same
 *      three-way routing, which moved `run-benchmark` in BOTH directions: it
 *      became `available` on `openai-assistants` (real tools, real safety
 *      assertions) and `unavailable` — no longer `degraded` — on an unserved
 *      runtime, because the runner now throws before the benchmark_runs insert
 *      rather than running a reduced form. Collapsing those verdicts into one
 *      boolean — or leaving a capability parroting a constraint the engine has
 *      since dropped — is the regression.
 *   2. NO AUTOMATIC PROMOTION. `available` on `promote` means a human MAY promote.
 *      Nothing in this module writes, decides, or schedules anything.
 *   3. FAIL-CLOSED. A backend read that fails yields `unavailable` WITH the error.
 *      Never `available` by default, never a fabricated `0`.
 *   4. NO DEAD BUTTONS. Every non-`available` capability carries a non-empty
 *      `reason` and `detail`, because the views render the reason next to the
 *      disabled control.
 *
 * Pure and offline: the four collaborators (`agent-detail`, `improvement-loop`,
 * `release-gate`, `postgrest`) are mocked in the style of release-gate.test.ts —
 * no network, no gpu1, no LLM, no secrets.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentDetail } from '@/lib/agent-mission-control/agent-detail'
import type { ImprovementProposal } from '@/lib/agent-mission-control/improvement-loop'
import type { ReleaseGate } from '@/lib/agent-mission-control/release-gate'
import type { Copilot, CopilotVersion } from '@/lib/agent-mission-control/types'

const COPILOT_ID = 'copilot-lifecycle-test'
const CANDIDATE_ID = 'version-candidate-lifecycle'
const PROD_ID = 'version-prod-lifecycle'
const ARCHIVED_ID = 'version-archived-lifecycle'

// --- mocked collaborators -------------------------------------------------

type PgrestHandler = (method: string, path: string) => unknown

let pgrestHandler: PgrestHandler
let detailResult: { detail: AgentDetail | undefined } | { throws: Error }
let proposalResult: { proposal: ImprovementProposal | null } | { throws: Error }
let gateResult: { gate: ReleaseGate | null } | { throws: Error }

vi.mock('@/lib/agent-mission-control/postgrest', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent-mission-control/postgrest')>(
    '@/lib/agent-mission-control/postgrest'
  )
  return {
    ...actual,
    pgrest: vi.fn(async (method: string, path: string) => pgrestHandler(method, path)),
  }
})

vi.mock('@/lib/agent-mission-control/agent-detail', () => ({
  getAgentDetail: vi.fn(async () => {
    if ('throws' in detailResult) throw detailResult.throws
    return detailResult.detail
  }),
}))

vi.mock('@/lib/agent-mission-control/improvement-loop', () => ({
  getLatestProposalForCopilot: vi.fn(async () => {
    if ('throws' in proposalResult) throw proposalResult.throws
    return proposalResult.proposal
  }),
}))

vi.mock('@/lib/agent-mission-control/release-gate', () => ({
  evaluateReleaseGate: vi.fn(async () => {
    if ('throws' in gateResult) throw gateResult.throws
    return gateResult.gate
  }),
}))

import { getAgentLifecycle, type AgentLifecycle, type Capability, type LifecycleActionId } from '@/lib/agent-mission-control/agent-lifecycle'

// --- fixtures -------------------------------------------------------------

function makeVersion(id: string, stage: CopilotVersion['stage'], label: string): CopilotVersion {
  return {
    id,
    copilotId: COPILOT_ID,
    label,
    stage,
    manifestId: `manifest-${id}`,
    model: 'gpt-5.4',
    modelProvider: 'openai',
    changelog: '',
    createdAt: '2026-07-01T00:00:00.000Z',
    createdBy: 'test',
    scores: {
      testPassRate: 1,
      benchmarkScore: 95,
      shadowAgreement: null,
      unsafeActionCount: null,
      confirmationMistakeCount: null,
    },
  } as CopilotVersion
}

function makeCopilot(overrides: Partial<Copilot> = {}): Copilot {
  return {
    id: COPILOT_ID,
    projectId: 'proj-tradeagent',
    targetProjectIds: [],
    name: 'Lifecycle Test Agent',
    slug: 'lifecycle-test-agent',
    description: '',
    runtime: 'langgraph',
    status: 'active',
    productionVersionId: PROD_ID,
    latestVersionId: CANDIDATE_ID,
    model: 'gpt-5.4',
    modelProvider: 'openai',
    owner: 'test',
    tags: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    health: {
      testPassRate: 1,
      benchmarkScore: 95,
      runsLast24h: 0,
      errorRateLast24h: 0,
      avgLatencyMs: 0,
      costLast24hUsd: 0,
      openWarnings: 0,
    },
    ...overrides,
  } as Copilot
}

function makeDetail(overrides: { copilot?: Partial<Copilot>; hasManifest?: boolean; versions?: CopilotVersion[] } = {}): AgentDetail {
  const versions = overrides.versions ?? [
    makeVersion(CANDIDATE_ID, 'draft', 'v2.0.0-draft'),
    makeVersion(PROD_ID, 'production', 'v1.1.0'),
    makeVersion(ARCHIVED_ID, 'archived', 'v1.0.0'),
  ]
  return {
    copilot: makeCopilot(overrides.copilot),
    agent: undefined,
    manifest: (overrides.hasManifest ?? true) ? ({ id: 'manifest-1' } as AgentDetail['manifest']) : undefined,
    versions,
    currentVersion: versions[0],
    tools: [],
    runs: [],
    blockers: [],
    executable: true,
    metrics: {
      runs24h: 0,
      totalRuns: 0,
      successRate: null,
      avgDurationMs: null,
      cost24hUsd: null,
      runsWithoutCost: 0,
      toolCallCount: null,
      lastRun: undefined,
    },
  } as AgentDetail
}

function makeGate(overrides: Partial<ReleaseGate> = {}): ReleaseGate {
  return {
    copilotId: COPILOT_ID,
    candidateVersionId: CANDIDATE_ID,
    promotable: true,
    checks: [
      { id: 'tests-pass', label: 'Tests pass rate', status: 'pass', observed: '100%', required: '100%' },
      { id: 'is-draft', label: 'Candidate is a draft', status: 'pass', observed: 'draft', required: 'draft' },
    ],
    ...overrides,
  } as ReleaseGate
}

function makeProposal(status: ImprovementProposal['status']): ImprovementProposal {
  return {
    id: 'improve-lifecycle-1',
    copilotId: COPILOT_ID,
    baseVersionId: PROD_ID,
    v2VersionId: status === 'proposed' ? null : CANDIDATE_ID,
    v2ManifestId: null,
    status,
    summary: 'test proposal',
    failureAnalysis: [],
    manifestChanges: {} as ImprovementProposal['manifestChanges'],
    sources: {} as ImprovementProposal['sources'],
    costUsd: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    createdBy: 'test',
    decidedBy: status === 'approved' || status === 'rejected' ? 'adrien' : null,
    decidedAt: status === 'approved' || status === 'rejected' ? '2026-07-02T00:00:00.000Z' : null,
  }
}

interface LifecycleMockConfig {
  detail?: AgentDetail | undefined | 'throws'
  suites?: Record<string, unknown>[] | 'throws'
  benchmarkSuites?: Record<string, unknown>[] | 'throws'
  benchmarkRuns?: Record<string, unknown>[]
  benchmarkResults?: Record<string, unknown>[]
  proposal?: ImprovementProposal | null | 'throws'
  gate?: ReleaseGate | null | 'throws'
}

const BACKEND_DOWN = new Error('fetch failed: connect ECONNREFUSED 10.0.0.1:3000')

function installMocks(config: LifecycleMockConfig = {}) {
  // Key PRESENCE, not `??`: `detail: undefined`, `proposal: null` and
  // `gate: null` are the cases under test — a nullish fallback would silently
  // replace each of them with the happy default and the test would pass by
  // testing nothing.
  detailResult =
    config.detail === 'throws'
      ? { throws: BACKEND_DOWN }
      : { detail: 'detail' in config ? config.detail : makeDetail() }
  proposalResult =
    config.proposal === 'throws'
      ? { throws: BACKEND_DOWN }
      : { proposal: 'proposal' in config ? (config.proposal as ImprovementProposal | null) : null }
  gateResult =
    config.gate === 'throws'
      ? { throws: BACKEND_DOWN }
      : { gate: 'gate' in config ? (config.gate as ReleaseGate | null) : makeGate() }

  pgrestHandler = (_method, path) => {
    if (path.startsWith('test_suites?')) {
      if (config.suites === 'throws') throw BACKEND_DOWN
      return config.suites ?? [{ id: 'suite-1' }]
    }
    if (path.startsWith('benchmark_suites?')) {
      if (config.benchmarkSuites === 'throws') throw BACKEND_DOWN
      return config.benchmarkSuites ?? [{ id: 'bsuite-1' }]
    }
    if (path.startsWith('benchmark_runs?')) {
      return config.benchmarkRuns ?? [{ id: 'brun-1', finished_at: '2026-07-10T00:00:00.000Z', started_at: null }]
    }
    if (path.startsWith('benchmark_results?')) {
      return config.benchmarkResults ?? [{ score: 95 }]
    }
    throw new Error(`Unmocked pgrest path: ${path}`)
  }
}

function cap(lifecycle: AgentLifecycle, id: LifecycleActionId): Capability {
  return lifecycle.capabilities[id]
}

/** Every non-available capability must be renderable next to its control. */
function assertNoDeadButtons(lifecycle: AgentLifecycle) {
  for (const [id, capability] of Object.entries(lifecycle.capabilities)) {
    if (capability.state === 'available') continue
    expect(capability.reason.trim().length, `${id} has an empty reason`).toBeGreaterThan(0)
    expect(capability.detail.trim().length, `${id} has an empty detail`).toBeGreaterThan(0)
  }
}

// --- 1. runtime compatibility --------------------------------------------

describe('getAgentLifecycle — runtime compatibility is explicit, never assumed', () => {
  beforeEach(() => installMocks())

  it('A — an openai-assistants agent with a project CAN run its test suite', async () => {
    // AIGENT-RUNNER-RUNTIME-029: runCase() now branches, and this runtime is
    // served by executeCopilotRun — the same engine the manual Run button
    // drives. The old `unavailable` verdict (and its "test-runner.ts has no
    // runtime branch" detail) became a lie the moment that branch landed; this
    // test exists so the capability can never drift back behind the engine.
    installMocks({ detail: makeDetail({ copilot: { runtime: 'openai-assistants' } }) })

    const lifecycle = await getAgentLifecycle(COPILOT_ID)
    expect(lifecycle).toBeDefined()

    expect(cap(lifecycle!, 'run-tests').state).toBe('available')
    assertNoDeadButtons(lifecycle!)
  })

  it('A2 — an openai-assistants agent on the validation bench cannot: agent_runs needs a project', async () => {
    // The direct path persists an agent_runs row per case and
    // agent_runs.project_id is NOT NULL, so runTestSuite() refuses up front.
    // A real refusal, and the only one left on this runtime.
    installMocks({
      detail: makeDetail({ copilot: { runtime: 'openai-assistants', projectId: null } }),
    })

    const lifecycle = await getAgentLifecycle(COPILOT_ID)
    const tests = cap(lifecycle!, 'run-tests')
    expect(tests.state).toBe('unavailable')
    expect(tests.state !== 'available' && tests.detail).toMatch(/agent_runs/)
    assertNoDeadButtons(lifecycle!)
  })

  it('A3 — a runtime with NO engine is refused, citing the real motive', async () => {
    // `gemini` has no branch in runCase()'s switch: runTestSuite() throws
    // UnsupportedRuntimeError before the first case. The reason must name THAT,
    // never the obsolete "test-runner.ts has no runtime branch".
    installMocks({ detail: makeDetail({ copilot: { runtime: 'gemini' as Copilot['runtime'] } }) })

    const lifecycle = await getAgentLifecycle(COPILOT_ID)
    const tests = cap(lifecycle!, 'run-tests')
    expect(tests.state).toBe('unavailable')
    expect(tests.state !== 'available' && tests.detail).toMatch(/UnsupportedRuntimeError/)
    // The dead reason from before the engine caught up must be gone.
    expect(tests.state !== 'available' && tests.detail).not.toMatch(/has no runtime branch/)
    assertNoDeadButtons(lifecycle!)
  })

  it('B — a langgraph agent with a suite can run its tests', async () => {
    installMocks({ detail: makeDetail({ copilot: { runtime: 'langgraph' } }), suites: [{ id: 'suite-1' }] })

    const lifecycle = await getAgentLifecycle(COPILOT_ID)
    expect(cap(lifecycle!, 'run-tests').state).toBe('available')
    expect(lifecycle!.suiteCount).toBe(1)
  })

  it('C — benchmark on openai-assistants is AVAILABLE: the engine caught up (030)', async () => {
    // The `degraded` verdict this replaces was true only while the off-graph
    // path was `runTaskViaCompletion` — a tool-less completion whose safety
    // score had to be withheld. AIGENT-BENCH-RUNTIME-030 deleted that function
    // and routes this runtime through executeCopilotRun with the manifest's
    // real tools, so the assertions observe ground truth and the safety score
    // is earned. Keeping `degraded` here would warn about a shortfall that no
    // longer exists, and a stale detail refuses what the engine now serves.
    installMocks({ detail: makeDetail({ copilot: { runtime: 'openai-assistants' } }) })

    const lifecycle = await getAgentLifecycle(COPILOT_ID)
    const bench = cap(lifecycle!, 'run-benchmark')
    expect(bench.state).toBe('available')
    assertNoDeadButtons(lifecycle!)
  })

  it('C2 — an openai-assistants agent on the validation bench cannot benchmark either', async () => {
    // The direct path persists an agent_runs row per TASK, same NOT NULL
    // project_id constraint as the test path — a real refusal, and the only one
    // left on this runtime.
    installMocks({
      detail: makeDetail({ copilot: { runtime: 'openai-assistants', projectId: null } }),
    })

    const bench = cap((await getAgentLifecycle(COPILOT_ID))!, 'run-benchmark')
    expect(bench.state).toBe('unavailable')
    expect(bench.state !== 'available' && bench.detail).toMatch(/agent_runs/)
  })

  it('C3 — a runtime with NO benchmark engine is UNAVAILABLE, not degraded', async () => {
    // runBenchmarkSuite() throws UnsupportedRuntimeError before the
    // benchmark_runs insert, so the action does not run in a reduced form — it
    // produces no run at all. `degraded` would promise a measurement that never
    // happens.
    installMocks({ detail: makeDetail({ copilot: { runtime: 'gemini' as Copilot['runtime'] } }) })

    const lifecycle = await getAgentLifecycle(COPILOT_ID)
    const bench = cap(lifecycle!, 'run-benchmark')
    expect(bench.state).toBe('unavailable')
    expect(bench.state !== 'available' && bench.detail).toMatch(/UnsupportedRuntimeError/)
    // The dead engine this capability used to describe must be gone.
    expect(bench.state !== 'available' && bench.detail).not.toMatch(/runTaskViaCompletion/)
    assertNoDeadButtons(lifecycle!)
  })

  it('C — benchmark on langgraph is fully available', async () => {
    installMocks({ detail: makeDetail({ copilot: { runtime: 'langgraph' } }) })
    expect(cap((await getAgentLifecycle(COPILOT_ID))!, 'run-benchmark').state).toBe('available')
  })

  it('D — suite generation is runtime-independent: it reads the manifest, it does not execute', async () => {
    // The one lifecycle action the runtime gap does not touch. An
    // openai-assistants agent with a manifest and no suite may still generate.
    installMocks({ detail: makeDetail({ copilot: { runtime: 'openai-assistants' } }), suites: [] })

    expect(cap((await getAgentLifecycle(COPILOT_ID))!, 'generate-suite').state).toBe('available')
  })
})

// --- 2. no automatic promotion -------------------------------------------

describe('getAgentLifecycle — promotion is a human act, restated not recomputed', () => {
  beforeEach(() => installMocks())

  it('E — a green gate makes promote available and nothing else happens', async () => {
    installMocks({ gate: makeGate({ promotable: true }) })

    const lifecycle = await getAgentLifecycle(COPILOT_ID)
    expect(cap(lifecycle!, 'promote').state).toBe('available')
    // `available` means a human MAY promote. No write occurred: the only pgrest
    // calls this module makes are reads, and the release gate is mocked to a
    // pure evaluation.
    const { pgrest } = await import('@/lib/agent-mission-control/postgrest')
    const calls = vi.mocked(pgrest).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    for (const [method] of calls) expect(method).toBe('GET')
  })

  it('F — a red gate blocks promotion and lists the blocking checks verbatim', async () => {
    installMocks({
      gate: makeGate({
        promotable: false,
        checks: [
          { id: 'tests-pass', label: 'Tests pass rate', status: 'fail', observed: '66%', required: '100%' },
          { id: 'benchmark-exists', label: 'Benchmark recorded', status: 'missing', observed: 'none', required: 'one run' },
        ],
      } as Partial<ReleaseGate>),
    })

    const lifecycle = await getAgentLifecycle(COPILOT_ID)
    const promote = cap(lifecycle!, 'promote')
    expect(promote.state).toBe('unavailable')
    expect(promote.state !== 'available' && promote.detail).toContain('Tests pass rate')
    expect(promote.state !== 'available' && promote.detail).toContain('Benchmark recorded')
    // The verdict is the gate's, not a second opinion.
    expect(lifecycle!.gate!.promotable).toBe(false)
  })

  it('G — approving a proposal that has no V2 is degraded, never silently allowed', async () => {
    // decideProposal() requires v2-created to approve. Offering a plain "Approve"
    // on a `proposed` row would promise a candidate that does not exist.
    installMocks({ proposal: makeProposal('proposed') })

    const decide = cap((await getAgentLifecycle(COPILOT_ID))!, 'decide')
    expect(decide.state).toBe('degraded')
    expect(decide.state !== 'available' && decide.detail).toMatch(/v2-created/)
  })

  it('G — an already-decided proposal cannot be decided again', async () => {
    installMocks({ proposal: makeProposal('approved') })

    const decide = cap((await getAgentLifecycle(COPILOT_ID))!, 'decide')
    expect(decide.state).toBe('unavailable')
    expect(decide.state !== 'available' && decide.reason).toMatch(/approved/i)
  })

  it('H — rollback needs a previously shipped version, not just any older row', async () => {
    // Rollback is exempt from the gate precisely because the target already
    // passed one. A draft has not: returning to it would ship ungated code.
    installMocks({
      detail: makeDetail({
        versions: [makeVersion(CANDIDATE_ID, 'draft', 'v2.0.0-draft'), makeVersion(PROD_ID, 'production', 'v1.1.0')],
      }),
    })

    const rollback = cap((await getAgentLifecycle(COPILOT_ID))!, 'rollback')
    expect(rollback.state).toBe('unavailable')
    expect(rollback.state !== 'available' && rollback.detail).toMatch(/archived/)
  })

  it('H — an archived version makes rollback available', async () => {
    installMocks()
    expect(cap((await getAgentLifecycle(COPILOT_ID))!, 'rollback').state).toBe('available')
  })
})

// --- 3. fail-closed -------------------------------------------------------

describe('getAgentLifecycle — fail-closed: an unread backend is never a green light', () => {
  beforeEach(() => installMocks())

  it('I — a missing copilot yields undefined, not an empty lifecycle', async () => {
    installMocks({ detail: undefined })
    expect(await getAgentLifecycle('copilot-does-not-exist')).toBeUndefined()
  })

  it('J — an unreadable test_suites table disables tests AND generation, never "0 suites"', async () => {
    // The failure mode this guards: `rows.length` on a failed read is not 0, and
    // a fabricated 0 would render "No suites" and offer to generate a duplicate.
    installMocks({ suites: 'throws' })

    const lifecycle = await getAgentLifecycle(COPILOT_ID)
    const tests = cap(lifecycle!, 'run-tests')
    const generate = cap(lifecycle!, 'generate-suite')
    expect(tests.state).toBe('unavailable')
    expect(generate.state).toBe('unavailable')
    expect(tests.state !== 'available' && tests.detail).toMatch(/not zero|unread/i)
    assertNoDeadButtons(lifecycle!)
  })

  it('K — an unreadable benchmark history disables the benchmark rather than guessing a baseline', async () => {
    installMocks({ detail: makeDetail({ copilot: { runtime: 'langgraph' } }), benchmarkSuites: 'throws' })

    const lifecycle = await getAgentLifecycle(COPILOT_ID)
    const bench = cap(lifecycle!, 'run-benchmark')
    expect(bench.state).toBe('unavailable')
    expect(lifecycle!.latestBenchmark).toBeNull()
    assertNoDeadButtons(lifecycle!)
  })

  it('L — a release gate that throws disables promotion with the error, not with silence', async () => {
    installMocks({ gate: 'throws' })

    const promote = cap((await getAgentLifecycle(COPILOT_ID))!, 'promote')
    expect(promote.state).toBe('unavailable')
    expect(promote.state !== 'available' && promote.detail).toMatch(/ECONNREFUSED/)
  })

  it('L — a null gate (no candidate version) also blocks promotion', async () => {
    installMocks({ gate: null })

    const promote = cap((await getAgentLifecycle(COPILOT_ID))!, 'promote')
    expect(promote.state).toBe('unavailable')
    expect(promote.state !== 'available' && promote.reason).toMatch(/candidate/i)
  })

  it('M — an unreadable improvement cycle blocks every cycle action at once', async () => {
    // Treating a failed read as "no proposal" would offer Analyse on an agent
    // with an open cycle and 409 on click.
    installMocks({ proposal: 'throws' })

    const lifecycle = await getAgentLifecycle(COPILOT_ID)
    for (const id of ['auto-improve', 'create-v2', 'decide'] as const) {
      expect(cap(lifecycle!, id).state, `${id} should be unavailable`).toBe('unavailable')
    }
    assertNoDeadButtons(lifecycle!)
  })

  it('N — every capability whose evidence failed to read goes unavailable, with the error', async () => {
    // Only `rollback` survives, and legitimately so: its evidence is the version
    // list, which came back with getAgentDetail. A capability must degrade on
    // ITS OWN failed read, not on a neighbour's — a blanket outage flag would
    // hide which read actually broke.
    installMocks({
      detail: makeDetail({ copilot: { runtime: 'openai-assistants' } }),
      suites: 'throws',
      benchmarkSuites: 'throws',
      proposal: 'throws',
      gate: 'throws',
    })

    const lifecycle = await getAgentLifecycle(COPILOT_ID)
    const evidenceUnread: LifecycleActionId[] = [
      'generate-suite',
      'run-tests',
      'run-benchmark',
      'auto-improve',
      'create-v2',
      'decide',
      'promote',
    ]
    for (const id of evidenceUnread) {
      expect(cap(lifecycle!, id).state, `${id} must not be available on an unread backend`).toBe('unavailable')
      const c = cap(lifecycle!, id)
      expect(c.state !== 'available' && c.detail, `${id} must name the failure`).toMatch(/ECONNREFUSED|failed/)
    }
    // Reading the version list succeeded, so this one keeps its real answer.
    expect(cap(lifecycle!, 'rollback').state).toBe('available')
    assertNoDeadButtons(lifecycle!)
    // No fabricated measurement leaked out of the failed reads.
    expect(lifecycle!.latestBenchmark).toBeNull()
    expect(lifecycle!.latestProposal).toBeNull()
    expect(lifecycle!.gate).toBeNull()
  })

  it('O — a missing manifest disables generation without pretending a suite exists', async () => {
    installMocks({ detail: makeDetail({ hasManifest: false }), suites: [] })

    const lifecycle = await getAgentLifecycle(COPILOT_ID)
    expect(lifecycle!.hasManifest).toBe(false)
    const generate = cap(lifecycle!, 'generate-suite')
    expect(generate.state).toBe('unavailable')
    expect(generate.state !== 'available' && generate.detail).toMatch(/manifest/i)
  })
})

// --- 4. mission validation cases -----------------------------------------

describe('getAgentLifecycle — the six VALIDATION cases', () => {
  beforeEach(() => installMocks())

  it('P — complete langgraph agent: everything the evidence supports is offered', async () => {
    installMocks({ detail: makeDetail({ copilot: { runtime: 'langgraph' } }) })

    const lifecycle = await getAgentLifecycle(COPILOT_ID)
    expect(cap(lifecycle!, 'run-tests').state).toBe('available')
    expect(cap(lifecycle!, 'run-benchmark').state).toBe('available')
    expect(cap(lifecycle!, 'promote').state).toBe('available')
    expect(cap(lifecycle!, 'rollback').state).toBe('available')
    // Generation refuses because a suite exists — idempotence, not a failure.
    expect(cap(lifecycle!, 'generate-suite').state).toBe('unavailable')
    assertNoDeadButtons(lifecycle!)
  })

  it('Q — no suite: tests refuse, generation opens', async () => {
    installMocks({ detail: makeDetail({ copilot: { runtime: 'langgraph' } }), suites: [] })

    const lifecycle = await getAgentLifecycle(COPILOT_ID)
    expect(lifecycle!.suiteCount).toBe(0)
    expect(cap(lifecycle!, 'run-tests').state).toBe('unavailable')
    expect(cap(lifecycle!, 'generate-suite').state).toBe('available')
    assertNoDeadButtons(lifecycle!)
  })

  it('R — no version at all: promote and rollback both refuse, with distinct reasons', async () => {
    installMocks({
      detail: makeDetail({ copilot: { productionVersionId: null }, versions: [] }),
      gate: null,
    })

    const lifecycle = await getAgentLifecycle(COPILOT_ID)
    expect(lifecycle!.versions).toHaveLength(0)
    expect(lifecycle!.productionVersion).toBeUndefined()
    expect(lifecycle!.candidateVersion).toBeUndefined()
    const promote = cap(lifecycle!, 'promote')
    const rollback = cap(lifecycle!, 'rollback')
    expect(promote.state).toBe('unavailable')
    expect(rollback.state).toBe('unavailable')
    // Two different problems must not share one canned sentence: "no candidate
    // to promote" and "nothing in production" send the operator elsewhere.
    if (promote.state === 'available' || rollback.state === 'available') throw new Error('unreachable')
    expect(promote.reason).not.toBe(rollback.reason)
    expect(rollback.reason).toMatch(/production/i)
  })

  it('S — inactive draft agent with no production: rollback refuses on the pointer, not on the stage', async () => {
    installMocks({
      detail: makeDetail({
        copilot: { status: 'draft', productionVersionId: null },
        versions: [makeVersion(CANDIDATE_ID, 'draft', 'v0.1.0-draft')],
      }),
    })

    const rollback = cap((await getAgentLifecycle(COPILOT_ID))!, 'rollback')
    expect(rollback.state).toBe('unavailable')
    expect(rollback.state !== 'available' && rollback.detail).toMatch(/production_version_id/)
  })

  it('T — openai-assistants agent: the signal unblocked itself with the engine', async () => {
    // collectImprovementSignals() reads test_runs?status=eq.completed and their
    // test_results in (fail,error) — rows, never a graph, and it never asks
    // which engine produced them. So the moment this runtime's suite can
    // complete, failing cases become recordable and the cycle has a real
    // source. Nothing was forced here: a condition simply stopped being true.
    installMocks({ detail: makeDetail({ copilot: { runtime: 'openai-assistants' } }) })

    expect(cap((await getAgentLifecycle(COPILOT_ID))!, 'auto-improve').state).toBe('available')
  })

  it('T2 — a runtime whose suite can never execute still has no signal to read', async () => {
    // The suite EXISTS but no engine can run it, so its cases can never reach
    // test_results in (fail,error). Distinct from "no suite at all", and the
    // detail must still end at analyzeAndPropose's own refusal.
    installMocks({ detail: makeDetail({ copilot: { runtime: 'gemini' as Copilot['runtime'] } }) })

    const improve = cap((await getAgentLifecycle(COPILOT_ID))!, 'auto-improve')
    expect(improve.state).toBe('unavailable')
    expect(improve.state !== 'available' && improve.detail).toMatch(/nothing to improve/)
  })

  it('T — a sub-target benchmark score is a real signal, whatever engine produced it', async () => {
    // A recorded score below the improve target IS evidence, whatever produced
    // it: the signal reads a stored row, never an engine. Refusing here would
    // hide a genuine regression behind a runtime rule.
    installMocks({
      detail: makeDetail({ copilot: { runtime: 'openai-assistants' } }),
      benchmarkResults: [{ score: 41 }],
    })

    const lifecycle = await getAgentLifecycle(COPILOT_ID)
    expect(lifecycle!.latestBenchmark?.score).toBe(41)
    expect(cap(lifecycle!, 'auto-improve').state).toBe('available')
  })

  it('U — an open cycle blocks a second one', async () => {
    installMocks({ detail: makeDetail({ copilot: { runtime: 'langgraph' } }), proposal: makeProposal('v2-created') })

    const lifecycle = await getAgentLifecycle(COPILOT_ID)
    expect(cap(lifecycle!, 'auto-improve').state).toBe('unavailable')
    // ...but the V2 it produced can now be decided.
    expect(cap(lifecycle!, 'decide').state).toBe('available')
    expect(cap(lifecycle!, 'create-v2').state).toBe('unavailable')
  })
})

// --- 5. absent data is never a fabricated zero ---------------------------

describe('getAgentLifecycle — absent measurement stays absent', () => {
  beforeEach(() => installMocks())

  it('V — a benchmark run with no result row reports score null, not 0', async () => {
    installMocks({ benchmarkResults: [] })

    const lifecycle = await getAgentLifecycle(COPILOT_ID)
    expect(lifecycle!.latestBenchmark).not.toBeNull()
    expect(lifecycle!.latestBenchmark!.score).toBeNull()
  })

  it('V — no benchmark suite at all reports null, distinct from "ran and scored nothing"', async () => {
    installMocks({ benchmarkSuites: [] })
    expect((await getAgentLifecycle(COPILOT_ID))!.latestBenchmark).toBeNull()
  })

  it('V — a non-numeric stored score is not coerced', async () => {
    installMocks({ benchmarkResults: [{ score: null }] })
    expect((await getAgentLifecycle(COPILOT_ID))!.latestBenchmark!.score).toBeNull()
  })
})

// --- 6. one canonical architecture ---------------------------------------

describe('agent lifecycle — a single derivation, a single gate, a single runner', () => {
  const ROOT = process.cwd()

  it('W — no competing lifecycle/release/test-runner module was reintroduced', () => {
    // 028 restores the FUNCTION, not the old four-page architecture. The failure
    // mode is a surface quietly shipping its own copy of the engine.
    const forbidden = [
      'src/lib/agent-mission-control/release-gate-v2.ts',
      'src/lib/agent-mission-control/lifecycle.ts',
      'src/lib/agent-mission-control/agent-lifecycle-client.ts',
      'src/lib/agent-mission-control/test-runner-v2.ts',
      'src/components/agent-ops/sections/tests-section.tsx',
      'src/components/agent-ops/sections/versions-section.tsx',
      'src/components/agent-ops/improve-workbench.tsx',
    ]
    for (const file of forbidden) {
      expect(existsSync(join(ROOT, file)), `${file} came back`).toBe(false)
    }
  })

  it('X — the lifecycle module reads the engine, it never reimplements it', () => {
    const src = readFileSync(join(ROOT, 'src/lib/agent-mission-control/agent-lifecycle.ts'), 'utf8')
    // Promotability comes from the release gate, not from a local re-derivation.
    expect(src.includes("from './release-gate'")).toBe(true)
    expect(src.includes("from './agent-detail'")).toBe(true)
    expect(src.includes("from './improvement-loop'")).toBe(true)
    // Read-only: no write verb reaches PostgREST from this module.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    for (const verb of ["'POST'", "'PATCH'", "'DELETE'", "'PUT'"]) {
      expect(code.includes(verb), `agent-lifecycle.ts must not issue ${verb}`).toBe(false)
    }
  })

  it('Y — every LifecycleActionId is derived; none is left to a view to invent', async () => {
    installMocks()
    const lifecycle = await getAgentLifecycle(COPILOT_ID)
    const expected: LifecycleActionId[] = [
      'generate-suite',
      'run-tests',
      'run-benchmark',
      'auto-improve',
      'create-v2',
      'decide',
      'promote',
      'rollback',
    ]
    expect(Object.keys(lifecycle!.capabilities).sort()).toEqual([...expected].sort())
  })
})
