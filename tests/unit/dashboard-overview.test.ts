/**
 * Unit tests — Dashboard overview helper (pure logic + fail-soft assembly).
 */
import { describe, expect, it, vi } from 'vitest'

import {
  assembleDashboardOverview,
  buildActionItems,
  buildProjectOverview,
  computeAvgRepoFit,
  computeBlockedDeliveries,
  computeCost24h,
  computeProductionAgents,
  computeReadyForManualTest,
  computeSandboxPassRate,
  computeSuccess24h,
  RUNS_READ_FAILED_WARNING,
  type DashboardOverview,
} from '@/lib/agent-mission-control/dashboard-overview'
import type { AgentRun } from '@/lib/agent-mission-control/types'
import type { DeliveryEvent } from '@/lib/agent-mission-control/delivery-events-store'
import type { Copilot, Project } from '@/lib/agent-mission-control/types'
// The fixture BOTH test projects read. See its header for why it is not a
// literal duplicated into each suite — that duplication is the defect class this
// branch closes, so it is not the mechanism used to test it.
import {
  CROSS_SCREEN_ITEMS,
  CROSS_SCREEN_PROJECTS,
  CROSS_SCREEN_TEAM,
} from '../fixtures/cross-screen-cost'

/** Health blob with every key present, so a test overrides only what it is about. */
function health(partial: Partial<Copilot['health']> = {}): Copilot['health'] {
  return {
    testPassRate: 1,
    benchmarkScore: 90,
    runsLast24h: 0,
    errorRateLast24h: 0,
    avgLatencyMs: 0,
    costLast24hUsd: 0,
    ...partial,
  }
}

function copilot(partial: Partial<Copilot> & Pick<Copilot, 'id' | 'name'>): Copilot {
  return {
    projectId: null,
    targetProjectIds: [],
    slug: partial.name.toLowerCase().replace(/\s+/g, '-'),
    description: '',
    runtime: 'langgraph',
    status: 'draft',
    productionVersionId: null,
    latestVersionId: 'v1',
    model: 'gpt-5.4',
    modelProvider: 'openai',
    owner: 'adrien',
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    health: {
      testPassRate: 1,
      benchmarkScore: 90,
      runsLast24h: 0,
      errorRateLast24h: 0,
      avgLatencyMs: 0,
      costLast24hUsd: 0,
    },
    ...partial,
  }
}

/**
 * One run in the 24h window. Defaults to a cheap completed run so a test only
 * states the field it is actually about (status / cost / startedAt).
 */
function agentRun(partial: Partial<AgentRun> & Pick<AgentRun, 'id'>): AgentRun {
  return {
    copilotId: 'c-btc',
    versionId: 'v1',
    projectId: 'proj-trade',
    userLabel: 'operator',
    startedAt: '2026-07-29T09:00:00Z',
    finishedAt: '2026-07-29T09:00:10Z',
    status: 'completed',
    stepIds: [],
    inputSummary: '',
    outputSummary: '',
    toolCallCount: 0,
    unsafeAttemptCount: 0,
    latencyMs: 1200,
    costUsd: null,
    traceUrl: null,
    ...partial,
  }
}

function deliveryEvent(status: string): DeliveryEvent {
  return {
    id: `evt_${status}`,
    mode: 'pull_request',
    targetRepo: 'adrien-debug/TradeAgent',
    targetBranch: 'main',
    deliveryBranch: 'agent/btc',
    commitSha: 'abc',
    commitUrl: 'u',
    prUrl: status === 'merged_validated' ? null : 'https://github.com/adrien-debug/TradeAgent/pull/4',
    prNumber: status === 'merged_validated' ? null : 4,
    status,
    createdAt: '2026-07-16T00:00:00Z',
  }
}

describe('dashboard KPIs', () => {
  it('1 — productionAgents counts production agents', () => {
    const n = computeProductionAgents([
      copilot({ id: 'a', name: 'A', productionVersionId: 'v1', displayStatus: 'production' }),
      copilot({ id: 'b', name: 'B' }),
    ])
    expect(n).toBe(1)
  })

  it('2 — readyForManualTest counts ready events', () => {
    expect(
      computeReadyForManualTest([
        deliveryEvent('ready_for_manual_test'),
        deliveryEvent('merged_validated'),
      ])
    ).toBe(1)
  })

  it('3 — sandboxPassRate ignores invalid empty set as null', () => {
    expect(computeSandboxPassRate([])).toBeNull()
    expect(
      computeSandboxPassRate([
        { status: 'passed' },
        { status: 'failed' },
        { status: 'passed' },
      ])
    ).toBe(67)
  })

  it('4 — avgRepoFit returns null if no data', () => {
    expect(computeAvgRepoFit([])).toBeNull()
    expect(computeAvgRepoFit([100, 80])).toBe(90)
  })

  it('5 — blockedDeliveries counts failed sandbox / blockers', () => {
    const latestDelivery = new Map<string, DeliveryEvent>([['c1', deliveryEvent('fixing')]])
    const latestSandbox = new Map([
      [
        'c1',
        {
          copilotId: 'c1',
          status: 'failed' as const,
          sandboxFitScore: 40,
          repoFitScore: 100,
          repo: 'r',
          createdAt: 't',
        },
      ],
    ])
    const scorecards = new Map([
      ['c1', { score: 56, level: 'not_ready', blockers: ['release_gate_red'], repoFitScore: 100, releaseGateRed: true }],
    ])
    expect(computeBlockedDeliveries(['c1'], latestDelivery, latestSandbox, scorecards, [])).toBeGreaterThan(0)
  })
})

describe('action items', () => {
  const projects: Project[] = [
    {
      id: 'proj-trade',
      name: 'TradeAgent',
      slug: 'tradeagent',
      description: '',
      platform: 'web',
      repoFullName: 'adrien-debug/TradeAgent',
      createdAt: '2026-01-01T00:00:00Z',
    },
  ]
  const projectsById = new Map(projects.map((p) => [p.id, p]))
  const copilotsById = new Map([
    ['c-btc', copilot({ id: 'c-btc', name: 'BTC Alert', projectId: 'proj-trade', productionVersionId: 'v1' })],
    ['c2', copilot({ id: 'c2', name: 'Other Agent', projectId: 'proj-trade' })],
  ])

  it('6 — actionItems prioritize ready_for_manual_test', () => {
    const items = buildActionItems({
      copilotsById,
      projectsById,
      latestDeliveryByCopilot: new Map([
        ['c-btc', deliveryEvent('ready_for_manual_test')],
        ['c2', deliveryEvent('execute_failed')],
      ]),
      latestSandboxByCopilot: new Map([
        [
          'c2',
          {
            copilotId: 'c2',
            status: 'failed' as const,
            sandboxFitScore: 0,
            repoFitScore: null,
            repo: 'r',
            createdAt: 't',
          },
        ],
      ]),
      scorecards: new Map(),
      missionRuns: [],
      dataWarnings: [],
    })
    expect(items[0]?.kind).toBe('ready_manual')
  })

})

describe('assembleDashboardOverview fail-soft', () => {
  it('8 — helper fail-soft when mission_runs absent (empty + warning)', () => {
    const overview = assembleDashboardOverview({
      copilots: [],
      projects: [],
      latestDeliveryByCopilot: new Map(),
      latestSandboxByCopilot: new Map(),
      scorecards: new Map(),
      missionRuns: [],
      dataWarnings: ['Mission data unavailable'],
      availableAgents: [],
      windowRuns: [],
    })
    expect(overview.dataWarnings).toContain('Mission data unavailable')
    expect(overview.kpis.productionAgents).toBe(0)
    // Empty-DB honesty: proven-empty availableAgents ([]) yields 0, not null —
    // only a FAILED load (availableAgents: null) should render '—'.
    expect(overview.kpis.executableNow).toBe(0)
    expect(overview.kpis.executableTotal).toBe(0)
    expect(overview.kpis.runs24h).toBe(0)
    expect(overview.kpis.success24h).toBeNull()
    expect(overview.kpis.cost24h).toBeNull()
    expect(overview.kpis.needsAction).toBe(0)
    expect(overview.actionItems).toEqual([])
  })

  it('8b — availableAgents: null (failed load) renders executableNow/Total as null, never 0', () => {
    const overview = assembleDashboardOverview({
      copilots: [],
      projects: [],
      latestDeliveryByCopilot: new Map(),
      latestSandboxByCopilot: new Map(),
      scorecards: new Map(),
      missionRuns: [],
      dataWarnings: ['Executable-agent data unavailable'],
      availableAgents: null,
      windowRuns: [],
    })
    expect(overview.kpis.executableNow).toBeNull()
    expect(overview.kpis.executableTotal).toBeNull()
  })

  it('12 — computeSuccess24h is null over zero terminal runs, never 0', () => {
    expect(computeSuccess24h([])).toBeNull()
    expect(computeSuccess24h([{ status: 'running' }, { status: 'blocked' }] as Pick<AgentRun, 'status'>[])).toBeNull()
    expect(
      computeSuccess24h([
        { status: 'completed' },
        { status: 'completed' },
        { status: 'failed' },
      ] as Pick<AgentRun, 'status'>[])
    ).toBe(67)
  })

  it('13 — computeCost24h is null over an empty window, never a coalesced 0', () => {
    expect(computeCost24h([])).toBeNull()
    // WAS `toBe(1.5)`. That assertion pinned the defect: `?? 0` folded the
    // unmeasured run in as a free one and returned a bare `1.5`, so a LOWER
    // BOUND was presented as THE cost of the window. The figure is unchanged —
    // what changed is that it now travels with the denominator that qualifies
    // it. Detailed cases in section C below.
    expect(computeCost24h([{ costUsd: null }, { costUsd: 1.5 }] as Pick<AgentRun, 'costUsd'>[])).toEqual({
      usd: 1.5,
      measuredRuns: 1,
      totalRuns: 2,
    })
  })

  it('9 — no GitHub write imported in dashboard-overview module', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../../src/lib/agent-mission-control/dashboard-overview.ts', import.meta.url), 'utf8')
    )
    expect(src).not.toMatch(/pushAgentToRepo|mergePullRequest|createPullRequest/)
  })

  it('10 — no fake data when DB empty', () => {
    const overview: DashboardOverview = assembleDashboardOverview({
      copilots: [copilot({ id: 'x', name: 'Lonely' })],
      projects: [],
      latestDeliveryByCopilot: new Map(),
      latestSandboxByCopilot: new Map(),
      scorecards: new Map(),
      missionRuns: [],
      dataWarnings: [],
      availableAgents: [],
      windowRuns: [],
    })
    expect(overview.kpis.sandboxPassRate).toBeNull()
    expect(overview.kpis.avgRepoFit).toBeNull()
    expect(overview.kpis.success24h).toBeNull()
    expect(overview.kpis.cost24h).toBeNull()
    expect(overview.projects).toEqual([])
    expect(overview.actionItems).toEqual([])
  })

  it('11 — buildProjectOverview rolls copilot health up per project', () => {
    const projects: Project[] = [
      {
        id: 'proj-trade',
        name: 'TradeAgent',
        slug: 'tradeagent',
        description: '',
        platform: 'web',
        repoFullName: 'adrien-debug/TradeAgent',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'proj-empty',
        name: 'Empty',
        slug: 'empty',
        description: '',
        platform: 'api',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ]
    const items = buildProjectOverview(projects, [
      copilot({
        id: 'c1',
        name: 'BTC Alert',
        projectId: 'proj-trade',
        status: 'active',
        healthEvidence: 'runs',
        // testPassRate is PROVEN here (not in the unavailable list) — the rollup
        // now counts a rate only when it is proven, never the placeholder 0.
        healthUnavailableFields: [],
        health: {
          testPassRate: 0.8,
          benchmarkScore: 90,
          runsLast24h: 10,
          errorRateLast24h: 0,
          avgLatencyMs: 0,
          costLast24hUsd: 2,
        },
      }),
      copilot({ id: 'c2', name: 'Draft Agent', projectId: 'proj-trade' }),
      copilot({ id: 'c3', name: 'Orphan' }),
    ])

    expect(items.map((i) => i.id)).toEqual(['proj-trade', 'proj-empty'])
    const trade = items[0]
    expect(trade.copilotCount).toBe(2)
    expect(trade.activeCount).toBe(1)
    expect(trade.runsLast24h).toBe(10)
    expect(trade.costLast24hUsd).toBe(2)
    // Only run-backed copilots feed passRate — c2 has no evidence.
    expect(trade.passRate).toBe(0.8)
    expect(items[1].passRate).toBeNull()
    expect(items[1].copilotCount).toBe(0)
  })
})

vi.mock('@/lib/agent-mission-control/data', () => ({
  getCopilots: vi.fn(async () => []),
  getProjects: vi.fn(async () => []),
  getRecentRunsInWindow: vi.fn(async () => []),
}))

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async () => {
    throw new Error('mission_runs missing')
  }),
  camelRows: (rows: unknown[]) => rows,
}))

describe('getDashboardOverview server collector', () => {
  it('fail-soft on mission table error', async () => {
    const { getDashboardOverview } = await import('@/lib/agent-mission-control/dashboard-overview')
    const overview = await getDashboardOverview()
    expect(overview.dataWarnings).toContain('Mission data unavailable')
    // getAvailableAgents() rides the same mocked (throwing) pgrest, so
    // executableNow must degrade to null + a warning, never a fabricated 0.
    expect(overview.dataWarnings).toContain('Executable-agent data unavailable')
    expect(overview.kpis.executableNow).toBeNull()
    expect(overview.kpis.executableTotal).toBeNull()
    expect(overview.kpis.runs24h).toBe(0)
    expect(overview.kpis.success24h).toBeNull()
    expect(overview.kpis.cost24h).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// A — the 24h run read: three states that must stay apart end to end
// ---------------------------------------------------------------------------

/** Fixed instant so the window boundary is never wall-clock dependent. */
const FIXED_NOW_MS = Date.parse('2026-07-29T12:00:00Z')

async function collectOverview(): Promise<DashboardOverview> {
  const { getDashboardOverview } = await import('@/lib/agent-mission-control/dashboard-overview')
  return getDashboardOverview(FIXED_NOW_MS)
}

/** The MOCKED reader, so a test can make the read reject — an empty array would
 *  test the opposite of what these tests are about. */
async function runsReader() {
  const data = await import('@/lib/agent-mission-control/data')
  return vi.mocked(data.getRecentRunsInWindow)
}

describe('A — the 24h run read is never swallowed', () => {
  it('A1 — read SUCCEEDS with zero runs: a MEASURED emptiness (0, [], no warning)', async () => {
    ;(await runsReader()).mockResolvedValueOnce([])

    const overview = await collectOverview()

    expect(overview.kpis.runs24h).toBe(0)
    expect(overview.windowRuns).toEqual([])
    // The window WAS read. Nothing about the run history is unavailable.
    expect(overview.dataWarnings).not.toContain(RUNS_READ_FAILED_WARNING)
  })

  it('A2 — read SUCCEEDS with runs: the measured values are reported', async () => {
    ;(await runsReader()).mockResolvedValueOnce([
      agentRun({ id: 'r1', status: 'completed', costUsd: 1.25 }),
      agentRun({ id: 'r2', status: 'completed', costUsd: 0.75 }),
      agentRun({ id: 'r3', status: 'failed', costUsd: 0.5 }),
      agentRun({ id: 'r4', status: 'running', costUsd: null }),
    ])

    const overview = await collectOverview()

    expect(overview.kpis.runs24h).toBe(4)
    expect(overview.windowRuns?.map((run) => run.id)).toEqual(['r1', 'r2', 'r3', 'r4'])
    // 2 completed over 3 terminal runs — `running` is excluded, not counted as failed.
    expect(overview.kpis.success24h).toBe(67)
    // 1.25 + 0.75 + 0.5 over the THREE runs that carried a measurable cost.
    // `r4` has `costUsd: null` — the cost of that run could not be measured, so
    // it is NOT summed in as a free run, and the record says so: the window held
    // 4 runs and only 3 of them support this figure. The previous assertion here
    // was `toBe(2.5)`, a bare number that could not admit the gap; its own
    // comment already said it was pinned "so the behaviour is visible… not
    // because it is right".
    expect(overview.kpis.cost24h).toEqual({ usd: 2.5, measuredRuns: 3, totalRuns: 4 })
    expect(overview.dataWarnings).not.toContain(RUNS_READ_FAILED_WARNING)
  })

  it('A3 — read FAILS: runs24h and windowRuns are NULL, not 0 and not []', async () => {
    ;(await runsReader()).mockRejectedValueOnce(new Error('agent_runs unreachable'))

    const overview = await collectOverview()

    expect(overview.kpis.runs24h).toBeNull()
    expect(overview.windowRuns).toBeNull()
    // Stated in the negative too: these are the two shapes a swallowed read produced.
    expect(overview.kpis.runs24h).not.toBe(0)
    expect(overview.windowRuns).not.toEqual([])
    // Everything derived from the unread window degrades with it.
    expect(overview.kpis.success24h).toBeNull()
    expect(overview.kpis.cost24h).toBeNull()
  })

  it('A4 — read FAILS: an explicit human sentence lands in dataWarnings', async () => {
    ;(await runsReader()).mockRejectedValueOnce(new Error('agent_runs unreachable'))

    const overview = await collectOverview()

    expect(overview.dataWarnings).toContain(RUNS_READ_FAILED_WARNING)
    // The UI prints dataWarnings VERBATIM — this must stay a sentence, not a code.
    expect(RUNS_READ_FAILED_WARNING).toBe('Run history unavailable')
  })

  it('A5 — read FAILS: the rest of the overview is STILL returned (degraded, not blanked)', async () => {
    const data = await import('@/lib/agent-mission-control/data')
    vi.mocked(data.getCopilots).mockResolvedValueOnce([
      copilot({
        id: 'c1',
        name: 'BTC Alert',
        projectId: 'proj-trade',
        status: 'active',
        productionVersionId: 'v1',
        healthUnavailableFields: [],
        health: health({ runsLast24h: 4, costLast24hUsd: 2 }),
      }),
    ])
    vi.mocked(data.getProjects).mockResolvedValueOnce([
      {
        id: 'proj-trade',
        name: 'TradeAgent',
        slug: 'tradeagent',
        description: '',
        platform: 'web',
        repoFullName: 'adrien-debug/TradeAgent',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ])
    ;(await runsReader()).mockRejectedValueOnce(new Error('agent_runs unreachable'))

    const overview = await collectOverview()

    expect(overview.kpis.runs24h).toBeNull()
    // …and everything that DID answer is still there, measured.
    expect(overview.kpis.productionAgents).toBe(1)
    expect(overview.projects.map((p) => p.id)).toEqual(['proj-trade'])
    expect(overview.projects[0].copilotCount).toBe(1)
    expect(overview.projects[0].activeCount).toBe(1)
    expect(overview.projects[0].runsLast24h).toBe(4)
    expect(overview.actionItems).toEqual([])
  })

  it('A5b — a null window still lets the action queue be built (pure assembly)', () => {
    const overview = assembleDashboardOverview({
      copilots: [copilot({ id: 'c-btc', name: 'BTC Alert', projectId: 'proj-trade' })],
      projects: [],
      latestDeliveryByCopilot: new Map([['c-btc', deliveryEvent('ready_for_manual_test')]]),
      latestSandboxByCopilot: new Map(),
      scorecards: new Map(),
      missionRuns: [],
      dataWarnings: [RUNS_READ_FAILED_WARNING],
      availableAgents: [],
      windowRuns: null,
    })

    expect(overview.kpis.runs24h).toBeNull()
    // The fixture event is ready-for-manual-test AND carries an open PR url, so
    // it legitimately produces two queue entries.
    expect(overview.actionItems.map((item) => item.kind)).toEqual(['ready_manual', 'pr_open'])
    expect(overview.kpis.needsAction).toBe(2)
    // Reads that succeeded keep their measured values next to the null one.
    expect(overview.kpis.executableNow).toBe(0)
    expect(overview.kpis.readyForManualTest).toBe(1)
  })

  it('A6 — ANTI-REGRESSION: a FAILED read and a SUCCESSFUL-but-empty read differ', async () => {
    ;(await runsReader()).mockResolvedValueOnce([])
    const measuredEmpty = await collectOverview()

    ;(await runsReader()).mockRejectedValueOnce(new Error('agent_runs unreachable'))
    const unread = await collectOverview()

    // Field by field — an assertion that only compared "something differs" could
    // be satisfied by unrelated drift and would prove nothing.
    expect(measuredEmpty.kpis.runs24h).toBe(0)
    expect(unread.kpis.runs24h).toBeNull()
    expect(measuredEmpty.windowRuns).toEqual([])
    expect(unread.windowRuns).toBeNull()
    expect(measuredEmpty.dataWarnings).not.toContain(RUNS_READ_FAILED_WARNING)
    expect(unread.dataWarnings).toContain(RUNS_READ_FAILED_WARNING)

    // And whole-object: the day the two collapse back into one shape, this fails.
    expect(unread.kpis).not.toEqual(measuredEmpty.kpis)
    expect(unread.windowRuns).not.toEqual(measuredEmpty.windowRuns)
    expect(unread.dataWarnings).not.toEqual(measuredEmpty.dataWarnings)
    expect(unread).not.toEqual(measuredEmpty)

    // success24h / cost24h are null in BOTH states — that is the documented
    // two-reason null, and dataWarnings is the ONLY discriminator.
    expect(measuredEmpty.kpis.success24h).toBeNull()
    expect(unread.kpis.success24h).toBeNull()
    expect(measuredEmpty.kpis.cost24h).toBeNull()
    expect(unread.kpis.cost24h).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// B — ProjectOverviewItem.runsLast24h: measured zero vs not measurable
// ---------------------------------------------------------------------------

function project(id: string, name: string): Project {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    description: '',
    platform: 'web',
    createdAt: '2026-01-01T00:00:00Z',
  }
}

describe('B — ProjectOverviewItem.runsLast24h can say "not measured"', () => {
  it('B1 — a PROVEN zero stays 0, never null', () => {
    const [item] = buildProjectOverview(
      [project('p1', 'Quiet')],
      [
        copilot({
          id: 'c1',
          name: 'Quiet Agent',
          projectId: 'p1',
          healthUnavailableFields: [],
          health: health({ runsLast24h: 0 }),
        }),
      ]
    )

    expect(item.runsLast24h).toBe(0)
    expect(item.runsLast24h).not.toBeNull()
  })

  it('B1b — a project with NO copilot is a measured 0 (no agent, no run to have made)', () => {
    const [item] = buildProjectOverview([project('p1', 'Empty')], [])

    expect(item.copilotCount).toBe(0)
    expect(item.runsLast24h).toBe(0)
  })

  it('B2 — proven counts are summed and reported unchanged', () => {
    const [item] = buildProjectOverview(
      [project('p1', 'Trade')],
      [
        copilot({
          id: 'c1',
          name: 'A',
          projectId: 'p1',
          healthUnavailableFields: [],
          health: health({ runsLast24h: 3 }),
        }),
        copilot({
          id: 'c2',
          name: 'B',
          projectId: 'p1',
          healthUnavailableFields: [],
          health: health({ runsLast24h: 4 }),
        }),
      ]
    )

    expect(item.runsLast24h).toBe(7)
  })

  it('B2b — an UNPROVEN placeholder never enters the sum', () => {
    const [item] = buildProjectOverview(
      [project('p1', 'Mixed')],
      [
        copilot({
          id: 'c1',
          name: 'Proven',
          projectId: 'p1',
          healthUnavailableFields: [],
          health: health({ runsLast24h: 3 }),
        }),
        copilot({
          id: 'c2',
          name: 'Placeholder',
          projectId: 'p1',
          // The 99 below is a normalisation placeholder, not a measurement.
          healthUnavailableFields: ['runsLast24h'],
          health: health({ runsLast24h: 99 }),
        }),
      ]
    )

    expect(item.runsLast24h).toBe(3)
  })

  it('B3 — a non-empty team where NOBODY proved a run count is not measurable → null', () => {
    const [item] = buildProjectOverview(
      [project('p1', 'Dark')],
      [
        copilot({
          id: 'c1',
          name: 'Named unavailable',
          projectId: 'p1',
          healthUnavailableFields: ['runsLast24h'],
          health: health({ runsLast24h: 99 }),
        }),
        // `healthUnavailableFields` undefined: the row never went through the
        // data layer, so nothing on it is proven.
        copilot({ id: 'c2', name: 'Never enriched', projectId: 'p1', health: health({ runsLast24h: 7 }) }),
      ]
    )

    expect(item.copilotCount).toBe(2)
    expect(item.runsLast24h).toBeNull()
    // The whole point: an absence must not arrive as a measurement.
    expect(item.runsLast24h).not.toBe(0)
  })
})

// ---------------------------------------------------------------------------
// C — cost: a measured zero, a PARTIAL measurement and an absence stay apart
//
// Same shape as section B, applied to the field that was still coalescing. Two
// different figures live under the word "cost" here and they are tested apart:
//
//  · `DashboardKpis.cost24h` — derived from the WINDOW's runs (`AgentRun.costUsd`)
//    and typed `Cost24hCoverage | null`, because a window can be measured only
//    IN PART: `costUsd === null` means the runner could not measure that run's
//    cost, not that the run was free.
//  · `ProjectOverviewItem.costLast24hUsd` — derived from the TEAM's health
//    (`copilot.health.costLast24hUsd`) and typed `number | null`, gated on the
//    same `isMeasuredHealth` rule the run count already uses.
//
// The two share one law, and every test below is an instance of it: `0` is only
// ever printed when something was measured at zero. An absence is `null` and
// renders `Indisponible` — never "$0.00", never an empty gauge, never a zero bar.
// ---------------------------------------------------------------------------

/** Read a source file of the app, for the two structural assertions at the end
 *  of this section. Same idiom test 9 already uses to prove an absence of
 *  imports — a behavioural test cannot see a `?? 0` that no fixture reaches. */
async function readSource(relativePath: string): Promise<string> {
  const fs = await import('node:fs/promises')
  return fs.readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8')
}

/** Runs reduced to the only field `computeCost24h` reads. */
function costs(...values: (number | null)[]): Pick<AgentRun, 'costUsd'>[] {
  return values.map((costUsd) => ({ costUsd }))
}

describe('C — computeCost24h never presents an absence as a measured zero', () => {
  it('C1 — a window that WAS read and held NO run is null, not a measured $0.00', () => {
    // DELIBERATE, and the direction was checked against the decision recorded on
    // the function itself rather than assumed: an empty sum is "nothing was
    // measured", not "the fleet cost zero dollars". The distinction is not
    // academic — `$0.00` under "Cost · 24h" is a claim about spend, and no read
    // established it. `runs24h` is what legitimately reports the measured 0 for
    // this same window (test A1), and the two live side by side on the screen.
    expect(computeCost24h([])).toBeNull()
    expect(computeCost24h([])).not.toEqual({ usd: 0, measuredRuns: 0, totalRuns: 0 })
  })

  it('C2 — every run measured: the exact sum, with full coverage stated', () => {
    expect(computeCost24h(costs(1.25, 0.75, 0.5))).toEqual({
      usd: 2.5,
      measuredRuns: 3,
      totalRuns: 3,
    })
  })

  it('C3 — runs measured AT ZERO produce a real zero WITH its support', () => {
    // The inverse of C1, and the reason the record exists: this `0` and the
    // absence in C1 are both "zero dollars" to a bare `number`, and they are not
    // the same statement. Here three runs were read and each one cost nothing.
    const measured = computeCost24h(costs(0, 0, 0))

    expect(measured).toEqual({ usd: 0, measuredRuns: 3, totalRuns: 3 })
    expect(measured).not.toBeNull()
    // A zero that is *structurally* distinguishable from an absence: it carries
    // support. `usd === 0 && measuredRuns === 0` can never be produced.
    expect(measured?.measuredRuns).toBeGreaterThan(0)
  })

  it('C4 — a run whose cost was NOT measured is not summed in as a free run', () => {
    const partial = computeCost24h(costs(2, null, null, 0.5))

    // The dollars that WERE measured are kept…
    expect(partial?.usd).toBe(2.5)
    // …and the figure carries what it does NOT cover, so the UI can say so.
    expect(partial).toEqual({ usd: 2.5, measuredRuns: 2, totalRuns: 4 })
    expect(partial?.measuredRuns).toBeLessThan(partial?.totalRuns ?? 0)
  })

  it('C5 — runs present but NOT ONE measurable: null, never a sum of skipped runs', () => {
    // The old `+ (r.costUsd ?? 0)` returned `0` here — three unmeasured runs
    // rendered as a confident "$0.00". There is no lower bound to state when the
    // support is empty, so there is no figure at all.
    expect(computeCost24h(costs(null, null, null))).toBeNull()
    expect(computeCost24h(costs(null))).toBeNull()
  })

  it('C6 — a non-finite cost is an absence, not a value to plot', () => {
    // NaN / Infinity can only come from a broken computation upstream; carrying
    // one into the total would make the whole KPI NaN and render as garbage.
    // `undefined` covers a row that never carried the column at all.
    const runs = [{ costUsd: Number.NaN }, { costUsd: 1 }, { costUsd: undefined }] as Pick<AgentRun, 'costUsd'>[]

    expect(computeCost24h(runs)).toEqual({ usd: 1, measuredRuns: 1, totalRuns: 3 })
    expect(computeCost24h([{ costUsd: Number.NaN }] as Pick<AgentRun, 'costUsd'>[])).toBeNull()
  })

  it('C7 — the run read FAILED: null, and it never even counts a length', () => {
    expect(computeCost24h(null)).toBeNull()
  })

  it('C7b — end to end through the collector, a failed read leaves cost null', async () => {
    ;(await runsReader()).mockRejectedValueOnce(new Error('agent_runs unreachable'))

    const overview = await collectOverview()

    expect(overview.kpis.cost24h).toBeNull()
    expect(overview.dataWarnings).toContain(RUNS_READ_FAILED_WARNING)
    // The discriminator, spelled out: an EMPTY-but-read window is also null here
    // (C1), and `dataWarnings` is the only thing that tells the two apart.
    ;(await runsReader()).mockResolvedValueOnce([])
    const readEmpty = await collectOverview()
    expect(readEmpty.kpis.cost24h).toBeNull()
    expect(readEmpty.dataWarnings).not.toContain(RUNS_READ_FAILED_WARNING)
  })
})

describe('C — ProjectOverviewItem.costLast24hUsd obeys the same rule as runs', () => {
  /** A team member with a cost the data layer PROVED. */
  function provenCost(id: string, costLast24hUsd: number, runsLast24h = 0): Copilot {
    return copilot({
      id,
      name: id,
      projectId: 'p1',
      healthUnavailableFields: [],
      health: health({ costLast24hUsd, runsLast24h }),
    })
  }

  it('C8 — a member whose cost sits in healthUnavailableFields makes it null', () => {
    const [item] = buildProjectOverview(
      [project('p1', 'Dark')],
      [
        copilot({
          id: 'c1',
          name: 'Named unavailable',
          projectId: 'p1',
          // The 99 is a normalisation placeholder (data.ts normalizeHealth), not
          // a measurement — `healthUnavailableFields` is what says so.
          healthUnavailableFields: ['costLast24hUsd'],
          health: health({ costLast24hUsd: 99 }),
        }),
        // `healthUnavailableFields` undefined: the row never went through the
        // data layer, so nothing on it is proven (types.ts › CopilotHealth).
        copilot({ id: 'c2', name: 'Never enriched', projectId: 'p1', health: health({ costLast24hUsd: 5 }) }),
      ]
    )

    expect(item.copilotCount).toBe(2)
    expect(item.costLast24hUsd).toBeNull()
    // Stated in the negative too — `0` is exactly what this used to render, and
    // "$0.00" is what the operator then read.
    expect(item.costLast24hUsd).not.toBe(0)
  })

  it('C9 — a PROVEN zero cost stays 0 and never gets relabelled absent', () => {
    // The inverse test. A rule that turns every zero into "Indisponible" is just
    // the old lie pointing the other way: this team was measured and it cost
    // nothing, which is a fact and must render as a real formatted zero.
    const [item] = buildProjectOverview([project('p1', 'Quiet')], [provenCost('c1', 0), provenCost('c2', 0)])

    expect(item.costLast24hUsd).toBe(0)
    expect(item.costLast24hUsd).not.toBeNull()
  })

  it('C10 — a project with NO copilot at all is a measured 0: no agent, no cost', () => {
    const [item] = buildProjectOverview([project('p1', 'Empty')], [])

    expect(item.copilotCount).toBe(0)
    expect(item.costLast24hUsd).toBe(0)
    // Same call the `/admin/projects` rollup makes for an empty team, so the two
    // screens answer the same way for a project nobody staffed.
    expect(item.runsLast24h).toBe(0)
  })

  it('C11 — proven costs are summed; an unproven placeholder never enters the total', () => {
    const [item] = buildProjectOverview(
      [project('p1', 'Mixed')],
      [
        provenCost('c1', 1.25),
        provenCost('c2', 0.75),
        copilot({
          id: 'c3',
          name: 'Placeholder',
          projectId: 'p1',
          healthUnavailableFields: ['costLast24hUsd'],
          health: health({ costLast24hUsd: 1000 }),
        }),
      ]
    )

    // 1.25 + 0.75. The 1000 is not merely "excluded" — it never existed as a
    // measurement, and its member does not drag the total to null either: two
    // members DID prove a cost.
    expect(item.costLast24hUsd).toBe(2)
  })

  it('C12 — cost and runs are proven INDEPENDENTLY; neither borrows the other proof', () => {
    const [item] = buildProjectOverview(
      [project('p1', 'Half proven')],
      [
        copilot({
          id: 'c1',
          name: 'Runs only',
          projectId: 'p1',
          healthUnavailableFields: ['costLast24hUsd'],
          health: health({ runsLast24h: 6, costLast24hUsd: 42 }),
        }),
      ]
    )

    expect(item.runsLast24h).toBe(6)
    expect(item.costLast24hUsd).toBeNull()

    // …and the mirror image, so the gate cannot be reading one field for both.
    const [mirror] = buildProjectOverview(
      [project('p1', 'Half proven')],
      [
        copilot({
          id: 'c1',
          name: 'Cost only',
          projectId: 'p1',
          healthUnavailableFields: ['runsLast24h'],
          health: health({ runsLast24h: 42, costLast24hUsd: 6 }),
        }),
      ]
    )

    expect(mirror.runsLast24h).toBeNull()
    expect(mirror.costLast24hUsd).toBe(6)
  })

  it('C12b — the whole assembled overview keeps a null cost null all the way out', () => {
    const overview = assembleDashboardOverview({
      copilots: [
        copilot({
          id: 'c1',
          name: 'Unproven cost',
          projectId: 'p1',
          status: 'active',
          healthUnavailableFields: ['costLast24hUsd'],
          health: health({ runsLast24h: 3, costLast24hUsd: 99 }),
        }),
      ],
      projects: [project('p1', 'Trade')],
      latestDeliveryByCopilot: new Map(),
      latestSandboxByCopilot: new Map(),
      scorecards: new Map(),
      missionRuns: [],
      dataWarnings: [],
      availableAgents: [],
      windowRuns: [],
    })

    expect(overview.projects[0].costLast24hUsd).toBeNull()
    // The project row and the window KPI are two different reads over two
    // different populations — both absent here, neither borrowed from the other.
    expect(overview.kpis.cost24h).toBeNull()
    expect(overview.projects[0].runsLast24h).toBe(3)
  })

  /**
   * C13 — THE CROSS-SCREEN PIN. One assertion, and the whole cross-screen claim
   * rests on it.
   *
   * `tests/unit/overview-screen-truth.test.tsx` (section D) renders BOTH screens
   * from `tests/fixtures/cross-screen-cost.ts`: `/admin/projects` gets the
   * `Copilot[]` and derives its own figures, `/admin` gets the
   * `ProjectOverviewItem[]` because it cannot call this module (`server-only`
   * throws under the browser conditions that suite runs in). The component test
   * therefore has to be TOLD what a team rolls up to — and THIS is where that is
   * checked against the real rollup.
   *
   * WHOLE OBJECTS, IN ORDER, on purpose: a stray `repoFullName`, a `passRate`
   * that is not what the sort/rollup produces, or a different emitted order
   * would leave the component suite rendering a project the data layer never
   * builds, with every one of its own assertions still green.
   */
  it('C13 — the data layer really derives the items the component suite renders', () => {
    expect(buildProjectOverview(CROSS_SCREEN_PROJECTS, CROSS_SCREEN_TEAM)).toEqual(CROSS_SCREEN_ITEMS)

    // Read out loud, so the pin is legible without opening the fixture: the
    // three states of the contract, side by side, from one team.
    const byId = new Map(CROSS_SCREEN_ITEMS.map((item) => [item.id, item]))
    expect(byId.get('p-proven')?.costLast24hUsd).toBe(12.5)
    expect(byId.get('p-zero')?.costLast24hUsd).toBe(0)
    expect(byId.get('p-dark')?.costLast24hUsd).toBeNull()
  })
})

describe('C — structural: the coalescence is gone and "measured" is ONE rule', () => {
  /** `buildProjectOverview` alone — bounded so an unrelated `?? 0` elsewhere in
   *  the module cannot fail this, and so a new one inside it cannot hide. */
  async function rollupSource(): Promise<string> {
    const source = await readSource('src/lib/agent-mission-control/dashboard-overview.ts')
    const start = source.indexOf('export function buildProjectOverview')
    const end = source.indexOf('// Pure — action items')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    return source.slice(start, end)
  }

  it('C14 — no `?? 0` / `|| 0` on a metric anywhere in the project rollup', async () => {
    const rollup = await rollupSource()

    // `costLast24hUsd: rollup?.costLast24hUsd ?? 0` is the exact line that made
    // an unproven cost render "$0.00". A behavioural test cannot see its return:
    // the fixture that would expose it is precisely the one the fix removed.
    expect(rollup).not.toMatch(/costLast24hUsd[^\n]*\?\?\s*0/)
    expect(rollup).not.toMatch(/costLast24hUsd[^\n]*\|\|\s*0/)
    expect(rollup).not.toMatch(/runsLast24h[^\n]*\?\?\s*0/)
    expect(rollup).not.toMatch(/runsLast24h[^\n]*\|\|\s*0/)
    // …while the two coalescences that ARE legitimate stay legitimate: a project
    // with no team really has 0 copilots and 0 active ones. Asserted so this
    // test is not silently satisfied by the whole block disappearing.
    expect(rollup).toMatch(/copilotCount: rollup\?\.copilotCount \?\? 0/)
    expect(rollup).toMatch(/activeCount: rollup\?\.activeCount \?\? 0/)
  })

  it('C15 — cost enters the rollup only through the same gate as runs', async () => {
    const rollup = await rollupSource()

    expect(rollup).toMatch(/isMeasuredHealth\(copilot, 'runsLast24h'\)/)
    expect(rollup).toMatch(/isMeasuredHealth\(copilot, 'costLast24hUsd'\)/)
    // A raw accumulation NOT wrapped in the gate is what this forbids: the
    // defect line read `current.costLast24hUsd += copilot.health.costLast24hUsd`
    // at the top level of the loop. It may only appear indented inside the `if`.
    const ungated = /\n {4}current\.costLast24hUsd \+=/
    expect(rollup).not.toMatch(ungated)
  })

  /**
   * C16 — ONE definition of "measured", not two that look alike.
   *
   * The rule lives in TWO files — `dashboard-overview.ts` (feeding `/admin`) and
   * `src/components/console/projects-screen.tsx` (feeding `/admin/projects`) —
   * because the data layer opens with `import 'server-only'` and a VALUE import
   * of it kills the browser-conditions test project. The duplication is
   * deliberate and documented at both sites; nothing except THIS test stops one
   * copy from being "improved" alone, and the day they differ the two screens go
   * back to stating different truths about the same project, which is the
   * divergence this branch exists to close.
   *
   * NAME-AGNOSTIC ON PURPOSE. The function is located by its SIGNATURE, not by
   * its identifier, so a rename cannot make this test quietly stop looking (it
   * would throw instead). Exactly one such function may exist per file.
   */
  it('C16 — the data layer and the projects screen share one rule, byte for byte', async () => {
    const [dataLayer, screenSource] = await Promise.all([
      readSource('src/lib/agent-mission-control/dashboard-overview.ts'),
      readSource('src/components/console/projects-screen.tsx'),
    ])

    const SIGNATURE = /function (\w+)\(copilot: Copilot, metric: CopilotHealthMetric\): boolean \{\n([\s\S]*?)\n\}/g

    function ruleIn(source: string, file: string): { name: string; body: string } {
      const found = [...source.matchAll(SIGNATURE)]
      if (found.length !== 1) {
        throw new Error(`${file} holds ${found.length} health-measurement rules; exactly 1 is the contract`)
      }
      return { name: found[0][1], body: found[0][2] }
    }

    const dataRule = ruleIn(dataLayer, 'dashboard-overview.ts')
    const screenRule = ruleIn(screenSource, 'projects-screen.tsx')

    // The extraction really found the rule — a regex that matched an empty body
    // would otherwise satisfy the comparison below and prove nothing.
    expect(dataRule.body).toContain('healthUnavailableFields === undefined')
    expect(dataRule.body).toContain('Number.isFinite')

    // What it DOES: identical, character for character.
    expect(screenRule.body).toBe(dataRule.body)
    // …and what it is CALLED: identical too, which is the stated mechanism for
    // making the pair impossible to edit in ignorance of each other.
    expect(screenRule.name).toBe(dataRule.name)
  })
})
