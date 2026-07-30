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
  it('5 of 6 terminal runs (83.33...%): card, small arc and large ring all read "83.3"', () => {
    const runs: AgentRun[] = [
      agentRun({ id: 'r1', status: 'completed' }),
      agentRun({ id: 'r2', status: 'completed' }),
      agentRun({ id: 'r3', status: 'completed' }),
      agentRun({ id: 'r4', status: 'completed' }),
      agentRun({ id: 'r5', status: 'completed' }),
      agentRun({ id: 'r6', status: 'failed' }),
    ]
    const { container } = render(<RunsScreen data={runsPageData({ runs, windowRunCount: runs.length })} />)

    // ONE precision rule for this metric, applied everywhere it is shown:
    // an integer stays an integer ("100%", "0%"), anything else keeps a single
    // decimal ("83.3%"). Before that rule the KPI card rounded to a whole
    // percent while the large ring kept a decimal, so the same measured rate
    // read "83" in one place and "83.3" two inches away.
    expect(screen.getByText('83.3%')).toBeTruthy()
    expect(screen.queryByText('83%')).toBeNull()

    // The small ArcGauge beside the card speaks the SAME figure it displays —
    // its aria-label no longer rounds independently of the card.
    const arcAria = [...container.querySelectorAll('svg[role="img"]')]
      .map((svg) => svg.getAttribute('aria-label') ?? '')
      .find((label) => label.startsWith('Success rate:') && label.includes('of 100'))
    expect(arcAria).toBe('Success rate: 83.3 of 100.')

    // The large 168px "Outcome mix" ring renders the identical figure.
    const ringText = [...container.querySelectorAll('text')].find((t) => t.textContent === '83.3')
    expect(ringText).toBeTruthy()
  })

  it('an empty window renders Indisponible on the card AND draws no gauge arc — never a rounded 0', () => {
    render(<RunsScreen data={runsPageData({ runs: [], windowRunCount: 0 })} />)
    expect(screen.getByText('Success')).toBeTruthy()
    expect(screen.getAllByText('Indisponible').length).toBeGreaterThan(0)
  })
})

describe('RunsScreen — observability workspace (filters, empty window, charts)', () => {
  it('an empty 24h window renders the compact panel — no run table, no filter form, no outcome ring', () => {
    render(<RunsScreen data={runsPageData({ runs: [], windowRunCount: 0 })} />)

    expect(screen.getByText('No agent produced an operational run in the last 24 hours.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to Agents' })).toBeTruthy()
    // No filter controls when there is nothing to filter.
    expect(screen.queryByLabelText('Filter by status')).toBeNull()
    // No "Operational run activity" table caption, no outcome-mix ring.
    expect(screen.queryByText('Run activity')).toBeNull()
    expect(screen.queryByText('Outcome mix')).toBeNull()
  })

  it('a non-empty window renders the filter form with real option lists, never a fabricated one', () => {
    const runs: AgentRun[] = [
      agentRun({ id: 'r1', copilotId: 'c-btc', status: 'completed' }),
      agentRun({ id: 'r2', copilotId: 'c-eth', status: 'failed' }),
    ]
    render(
      <RunsScreen
        data={runsPageData({
          runs,
          windowRunCount: runs.length,
          agentNameById: new Map([
            ['c-btc', 'BTC Agent'],
            ['c-eth', 'ETH Agent'],
          ]),
        })}
      />
    )

    expect(screen.getByLabelText('Filter by status')).toBeTruthy()
    expect(screen.getByLabelText('Filter by agent')).toBeTruthy()
    expect(screen.getAllByText('BTC Agent').length).toBeGreaterThan(0)
    expect(screen.getAllByText('ETH Agent').length).toBeGreaterThan(0)
  })

  it('a status filter narrows the table AND the KPI band from the SAME derivation, and states the match count', () => {
    const runs: AgentRun[] = [
      agentRun({ id: 'r1', status: 'completed' }),
      agentRun({ id: 'r2', status: 'failed' }),
    ]
    render(
      <RunsScreen
        data={runsPageData({ runs, windowRunCount: runs.length })}
        filters={{ q: '', agent: '', project: '', status: 'failed', period: '24h', provider: '', model: '', duration: '', cost: '' }}
      />
    )

    expect(screen.getByText('1 of 2 loaded runs shown · table capped at 200')).toBeTruthy()
    const runsShownCard = kpiCard('Runs shown')
    expect(within(runsShownCard).getByText('1')).toBeTruthy()
  })

  it('a filter that narrows a real window to zero rows says so in the table, distinct from a truly empty window', () => {
    const runs: AgentRun[] = [agentRun({ id: 'r1', status: 'completed' })]
    render(
      <RunsScreen
        data={runsPageData({ runs, windowRunCount: runs.length })}
        filters={{ q: '', agent: '', project: '', status: 'blocked', period: '24h', provider: '', model: '', duration: '', cost: '' }}
      />
    )

    expect(screen.getByText('No run matches the current filters.')).toBeTruthy()
  })

  it('a run with no measured cost renders Indisponible in its own table cell, never "$0.00"', () => {
    const runs: AgentRun[] = [agentRun({ id: 'r1', status: 'completed', costUsd: null })]
    render(<RunsScreen data={runsPageData({ runs, windowRunCount: runs.length })} />)

    expect(screen.queryByText('$0.00')).toBeNull()
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
