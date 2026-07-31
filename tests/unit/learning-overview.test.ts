/**
 * learning-overview.test.ts — offline coverage for `learning-overview.ts`.
 *
 * `getDashboardOverview` and `getLearningRuntimeHealth` are mocked wholesale
 * (vi.mock) — this module COMPOSES them, it does not re-derive their rules,
 * so the test asserts composition, not re-litigating dashboard-overview's own
 * (separately tested) three-state contract. No network, no DB.
 */
import { describe, expect, it, vi } from 'vitest'

import type { DashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'
import type { LearningRuntimeHealth } from '@/lib/agent-mission-control/learning-runtime'
import type { AgentRun, Copilot, Project } from '@/lib/agent-mission-control/types'

let mockDashboardOverview: DashboardOverview | null = null
let mockLearningRuntimeHealth: LearningRuntimeHealth | null = null

vi.mock('@/lib/agent-mission-control/dashboard-overview', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent-mission-control/dashboard-overview')>(
    '@/lib/agent-mission-control/dashboard-overview'
  )
  return {
    ...actual,
    getDashboardOverview: vi.fn(async () => {
      if (mockDashboardOverview === null) throw new Error('mockDashboardOverview not set')
      return mockDashboardOverview
    }),
  }
})

vi.mock('@/lib/agent-mission-control/learning-runtime', () => ({
  getLearningRuntimeHealth: vi.fn(async () => {
    if (mockLearningRuntimeHealth === null) throw new Error('mockLearningRuntimeHealth not set')
    return mockLearningRuntimeHealth
  }),
}))

// Imported AFTER the mocks so the module under test picks up the mocked deps.
const { getLearningOverview, computeFailedRunsInWindow, EVALUATIONS_NOT_MEASURED_REASON } = await import(
  '@/lib/agent-mission-control/learning-overview'
)

// Le mock lui-même, récupéré comme spy : c'est sur l'APPEL amont que porte la
// preuve du « file complète » — Learning demande une limite haute, il ne
// re-dérive rien.
const { getDashboardOverview: dashboardOverviewSpy, FULL_ACTION_QUEUE_LIMIT } = await import(
  '@/lib/agent-mission-control/dashboard-overview'
)

const NOW_MS = Date.parse('2026-07-31T12:00:00.000Z')

const mockCopilot: Copilot = {
  id: 'cop-1',
  projectId: 'proj-1',
  name: 'Test Agent',
  description: null,
  status: 'active',
  displayStatus: 'production',
  runtime: 'langgraph',
  productionVersionId: 'v1',
  healthUnavailableFields: [],
  health: {
    runsLast24h: 0,
    costLast24hUsd: 0,
    testPassRate: 0,
  },
} as unknown as Copilot

const mockProject: Project = {
  id: 'proj-1',
  name: 'Test Project',
  imageUrl: null,
  logoUrl: null,
  repoFullName: null,
  platform: 'github',
} as unknown as Project

function baseDashboardOverview(overrides: Partial<DashboardOverview> = {}): DashboardOverview {
  return {
    kpis: {
      productionAgents: 1,
      readyForManualTest: 0,
      sandboxPassRate: null,
      avgRepoFit: null,
      blockedDeliveries: 0,
      executableNow: 1,
      executableTotal: 1,
      runs24h: 0,
      success24h: null,
      cost24h: null,
      needsAction: 0,
    },
    projects: [],
    copilots: [mockCopilot],
    projectRows: [mockProject],
    actionItems: [],
    dataWarnings: [],
    windowRuns: [],
    telemetryHealth: {
      status: 'not_configured',
      summary: 'not configured',
      daysSinceLastEvent: null,
      agentsWithTelemetryDeclared: null,
    },
    telemetryReportingAgents: null,
    telemetryRunsMeasured: null,
    recentDeliveries: [],
    pendingArchitectApprovals: [],
    recentTelemetryEvents: [],
    ...overrides,
  }
}

const liveLearningRuntime: LearningRuntimeHealth = {
  status: 'live',
  checkedAt: new Date(NOW_MS).toISOString(),
  endpoint: 'https://learning.internal.example',
  capabilities: ['train'],
  detail: null,
  latencyMs: 12,
}

describe('computeFailedRunsInWindow', () => {
  it('returns null when the window read failed — never 0', () => {
    expect(computeFailedRunsInWindow(null)).toBeNull()
  })

  it('returns a measured 0 for an empty (successfully read) window', () => {
    expect(computeFailedRunsInWindow([])).toBe(0)
  })

  it('counts only status === failed, not blocked/needs-confirmation/running', () => {
    const runs = [
      { status: 'failed' },
      { status: 'completed' },
      { status: 'blocked' },
      { status: 'needs-confirmation' },
      { status: 'running' },
      { status: 'failed' },
    ] as unknown as AgentRun[]
    expect(computeFailedRunsInWindow(runs)).toBe(2)
  })
})

describe('getLearningOverview', () => {
  it('propagates a failed window read as null, not a coerced 0', async () => {
    mockDashboardOverview = baseDashboardOverview({
      windowRuns: null,
      dataWarnings: ['Run history unavailable'],
    })
    mockLearningRuntimeHealth = liveLearningRuntime

    const overview = await getLearningOverview(NOW_MS)

    expect(overview.supervision.runsInWindow).toBeNull()
    expect(overview.supervision.failedRunsInWindow).toBeNull()
    expect(overview.dataWarnings).toContain('Run history unavailable')
  })

  it('attributes a partial Aigent-side source failure via dataWarnings, never silently drops it', async () => {
    mockDashboardOverview = baseDashboardOverview({
      recentDeliveries: null,
      dataWarnings: ['Delivery event data unavailable'],
    })
    mockLearningRuntimeHealth = liveLearningRuntime

    const overview = await getLearningOverview(NOW_MS)

    expect(overview.dataWarnings).toEqual(['Delivery event data unavailable'])
    // La panne est attribuée par `dataWarnings`, la ligne de file étant
    // produite en amont par `buildActionItems` dans `getDashboardOverview`
    // (voir `learning-overview.ts` : la file n'est jamais re-dérivée ici, sans
    // quoi des sources réellement lues seraient rendues « indisponibles »).
    expect(overview.dataWarnings.length).toBeGreaterThan(0)
  })

  it('never renders an unmeasured evaluations zone as a fabricated pass/fail', async () => {
    mockDashboardOverview = baseDashboardOverview()
    mockLearningRuntimeHealth = liveLearningRuntime

    const overview = await getLearningOverview(NOW_MS)

    expect(overview.evaluations.perCopilotScorecards).toBeNull()
    expect(overview.evaluations.reason).toBe(EVALUATIONS_NOT_MEASURED_REASON)
  })

  it('surfaces the learning runtime health exactly as returned by getLearningRuntimeHealth', async () => {
    mockDashboardOverview = baseDashboardOverview()
    mockLearningRuntimeHealth = {
      status: 'not_configured',
      checkedAt: new Date(NOW_MS).toISOString(),
      endpoint: null,
      capabilities: null,
      detail: 'not configured',
      latencyMs: null,
    }

    const overview = await getLearningOverview(NOW_MS)

    expect(overview.learningRuntime.status).toBe('not_configured')
    expect(overview.learningRuntime.capabilities).toBeNull()
  })

  it('demande la file COMPLÈTE en transmettant le plafond de revue en amont', async () => {
    // Le point du test : Learning ne re-dérive PAS la file, il demande à
    // `getDashboardOverview` de ne pas la tronquer. C'est l'appel amont qui
    // porte la preuve, parce que c'est le seul endroit disposant des vraies
    // entrées (sandbox, scorecards, missions).
    mockDashboardOverview = baseDashboardOverview()
    mockLearningRuntimeHealth = liveLearningRuntime

    await getLearningOverview(NOW_MS)

    expect(dashboardOverviewSpy).toHaveBeenCalledWith(NOW_MS, {
      actionItemsLimit: FULL_ACTION_QUEUE_LIMIT,
    })
    // Et le plafond de revue est franchement au-dessus de la tranche de six
    // de l'aperçu — sinon « file complète » ne voudrait rien dire.
    expect(FULL_ACTION_QUEUE_LIMIT).toBeGreaterThan(6)
  })

  it('rend la file de l’aperçu telle quelle, sans la re-dériver', async () => {
    const items = [
      { id: 'a1', kind: 'architect_approval', title: 't', meta: 'm', status: 's', href: '/', buttonLabel: 'b', priority: 0 },
      { id: 'a2', kind: 'ready_manual', title: 't', meta: 'm', status: 's', href: '/', buttonLabel: 'b', priority: 1 },
    ] as DashboardOverview['actionItems']
    mockDashboardOverview = baseDashboardOverview({ actionItems: items })
    mockLearningRuntimeHealth = liveLearningRuntime

    const overview = await getLearningOverview(NOW_MS)

    expect(overview.reviewQueue.isFullQueue).toBe(true)
    expect(overview.reviewQueue.items).toEqual(items)
    // Aucune ligne « source indisponible » fabriquée : les sources de
    // l'aperçu ont été lues, Learning ne peut pas prétendre le contraire.
    expect(overview.reviewQueue.items.some((i) => i.kind === 'data_unavailable')).toBe(false)
  })
})
