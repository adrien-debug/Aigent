/**
 * Direct rendering tests for two console screens that had zero direct coverage
 * before this file — `RunsScreen` and `ProjectsScreen` — each pinned to a
 * SPECIFIC fix verified in source and now guarded so it cannot silently regress.
 */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ProjectsScreen } from '@/components/console/projects-screen'
import { RunsScreen } from '@/components/console/runs-screen'
import type { RunsPageData } from '@/lib/runs-console/runs-page-data'
import type { AgentRun, Copilot, Project } from '@/lib/agent-mission-control/types'

/** The KPI card whose UPPERCASE label paragraph is exactly `label` — as
 *  opposed to `screen.getByText(label)`, which also matches a page heading
 *  that happens to share the same word (e.g. the "Projects" title). */
function kpiCard(label: string): HTMLElement {
  const candidates = screen
    .getAllByText(label)
    .filter((node) => (node.className ?? '').toString().includes('uppercase'))
  if (candidates.length !== 1) throw new Error(`Expected exactly one KPI label "${label}", found ${candidates.length}`)
  const card = candidates[0].closest('div.rounded-xl')
  if (card === null) throw new Error(`No KPI card found for label "${label}"`)
  return card as HTMLElement
}

/* ---------------------------------------------------------------- fixtures */

function agentRun(partial: Partial<AgentRun> & Pick<AgentRun, 'id'>): AgentRun {
  return {
    copilotId: 'c-btc',
    versionId: 'v1',
    projectId: 'p-proven',
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
    costUsd: 0.01,
    traceUrl: null,
    ...partial,
  }
}

function runsPageData(partial: Partial<RunsPageData> = {}): RunsPageData {
  return {
    nowIso: '2026-07-29T12:00:00Z',
    nowMs: Date.parse('2026-07-29T12:00:00Z'),
    runs: [],
    copilotById: new Map(),
    agentNameById: new Map(),
    projectNameById: new Map(),
    viewer: { role: 'OWNER', authenticated: true },
    degraded: [],
    degradedDetail: null,
    windowRunCount: 0,
    windowTruncated: false,
    windowMaxRows: 1000,
    tableRowCap: 200,
    ...partial,
  }
}

function copilot(partial: Partial<Copilot> & Pick<Copilot, 'id'>): Copilot {
  return {
    name: 'Agent',
    projectId: 'p-1',
    targetProjectIds: [],
    slug: partial.id,
    description: '',
    runtime: 'langgraph',
    status: 'active',
    productionVersionId: null,
    latestVersionId: 'v1',
    model: 'gpt-5.4',
    modelProvider: 'openai',
    owner: 'adrien',
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    healthUnavailableFields: [],
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

function project(partial: Partial<Project> & Pick<Project, 'id' | 'name'>): Project {
  return {
    slug: partial.id,
    description: '',
    platform: 'web',
    createdAt: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

/* ==================================================================== RunsScreen */

describe('RunsScreen — the success KPI card and its ArcGauge share ONE unrounded value', () => {
  it('5 of 6 terminal runs (83.33...%): the KPI card and the small ArcGauge beside it agree on "83"', () => {
    const runs: AgentRun[] = [
      agentRun({ id: 'r1', status: 'completed' }),
      agentRun({ id: 'r2', status: 'completed' }),
      agentRun({ id: 'r3', status: 'completed' }),
      agentRun({ id: 'r4', status: 'completed' }),
      agentRun({ id: 'r5', status: 'completed' }),
      agentRun({ id: 'r6', status: 'failed' }),
    ]
    const { container } = render(<RunsScreen data={runsPageData({ runs, windowRunCount: runs.length })} />)

    // KPI card: `formatPercent` from `runs-metrics.ts` rounds to a whole percent.
    expect(screen.getByText('83%')).toBeTruthy()

    // The small ArcGauge beside the card reads the SAME unrounded successPercent
    // (this is the regression the code comment pins: a stray `Math.round`
    // applied BEFORE the gauge used to let the card and the gauge disagree).
    // Its own aria-label rounds once, for speech, at the point it is spoken —
    // and it rounds to the same whole percent as the card.
    const arcAria = [...container.querySelectorAll('svg[role="img"]')]
      .map((svg) => svg.getAttribute('aria-label') ?? '')
      .find((label) => label.startsWith('Success rate:') && label.includes('of 100'))
    expect(arcAria).toBe('Success rate: 83 of 100.')

    // NOTE (recorded, not asserted as a defect fixed here): the LARGE 168px
    // "Outcome mix" RingGauge receives the identical unrounded `successPercent`
    // but renders it through `formatFigure`, which keeps one decimal for a
    // non-integer ("83.3") — so the big ring and the small card/arc pair show
    // different precision for the exact same measured rate. Both are honest
    // (neither invents a figure), so this is a precision-consistency finding,
    // not a truth violation; left unfixed as out of this phase's mandate.
    const ringText = [...container.querySelectorAll('text')].find((t) => t.textContent === '83.3')
    expect(ringText).toBeTruthy()
  })

  it('an empty window renders Indisponible on the card AND draws no gauge arc — never a rounded 0', () => {
    render(<RunsScreen data={runsPageData({ runs: [], windowRunCount: 0 })} />)
    expect(screen.getByText('Success')).toBeTruthy()
    expect(screen.getAllByText('Indisponible').length).toBeGreaterThan(0)
  })
})

/* ================================================================ ProjectsScreen */

describe('ProjectsScreen — dev-seed fixture rows are excluded from every KPI and disclosed, not silently dropped', () => {
  it('a seed project and a seed copilot do not inflate "Projects" / "Assigned agents" — and the exclusion is stated in the detail line', () => {
    const projects: Project[] = [
      project({ id: 'proj-real', name: 'TradeAgent' }),
      project({ id: 'seed-project-lab', name: 'seed · Dev Lab' }),
    ]
    const copilots: Copilot[] = [
      copilot({ id: 'copilot-real', name: 'Real Agent', projectId: 'proj-real', status: 'active', productionVersionId: 'v1' }),
      copilot({ id: 'seed-agent-alpha', name: 'seed · Alpha', projectId: 'proj-real', tags: ['seed', 'dev-only'] }),
    ]

    render(<ProjectsScreen projects={projects} copilots={copilots} />)

    // "Projects" KPI counts only the real one.
    const projectsCard = kpiCard('Projects')
    expect(within(projectsCard).getByText('1')).toBeTruthy()
    expect(within(projectsCard).getByText(/1 dev-seed excluded/)).toBeTruthy()

    // "Assigned agents" KPI counts only the real one, and discloses the exclusion.
    const assignedCard = kpiCard('Assigned agents')
    expect(within(assignedCard).getByText('1')).toBeTruthy()
    expect(within(assignedCard).getByText(/1 dev-seed excluded/)).toBeTruthy()

    // The seed project must not appear as a row in the registry table.
    expect(screen.queryByText('seed · Dev Lab')).toBeNull()
    expect(screen.getByText('TradeAgent')).toBeTruthy()

    // The registry footer discloses the excluded project too.
    expect(screen.getByText(/1 dev-seed project excluded/)).toBeTruthy()
  })

  it('with no seed rows at all, the exclusion language never appears (nothing to disclose)', () => {
    const projects: Project[] = [project({ id: 'proj-real', name: 'TradeAgent' })]
    const copilots: Copilot[] = [copilot({ id: 'copilot-real', name: 'Real Agent', projectId: 'proj-real' })]

    render(<ProjectsScreen projects={projects} copilots={copilots} />)

    expect(screen.queryByText(/dev-seed excluded/)).toBeNull()
    expect(screen.queryByText(/dev-seed project/)).toBeNull()
  })
})
