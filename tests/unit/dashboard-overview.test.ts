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
    expect(computeCost24h([{ costUsd: null }, { costUsd: 1.5 }] as Pick<AgentRun, 'costUsd'>[])).toBe(1.5)
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
    // 1.25 + 0.75 + 0.5. `r4` carries `costUsd: null` (cost not measurable for
    // that run) and `computeCost24h` folds it in as 0 — a KNOWN, pre-existing
    // and NARROWER gap than this mission's: it is per-run cost absence INSIDE a
    // window that was successfully read, not a failed read. Asserted here so the
    // behaviour is visible rather than assumed, not because it is right.
    expect(overview.kpis.cost24h).toBe(2.5)
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
