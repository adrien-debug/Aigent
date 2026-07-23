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
  type DashboardOverview,
} from '@/lib/agent-mission-control/dashboard-overview'
import type { AgentRun } from '@/lib/agent-mission-control/types'
import type { DeliveryEvent } from '@/lib/agent-mission-control/delivery-events-store'
import type { Copilot, Project } from '@/lib/agent-mission-control/types'

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
    expect(overview.kpis.needsAction).toBe(overview.actionItems.length)
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
