/**
 * `ProjectsScreen` — the enrichment landed on top of the existing registry
 * table: the "Last delivery" column built from `Copilot.lastPushedAt` /
 * `lastPushStatus` / `lastPushCommitUrl` (already part of every copilot read,
 * no new source), and the standing disclosure that the consumer-side active
 * version / version drift is structurally unknown to Aigent (it lives in
 * `agents/_registry.json` inside the CONSUMER repo — `docs/known-gaps.md`).
 *
 * Three cases: a project with a full team and a real delivery, a project with
 * no linked repo, and the drift disclosure that must render regardless of
 * either — never derived from a delivery event, always stated as unknown.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ProjectsScreen } from '@/components/console/projects-screen'
import type { Copilot, Project } from '@/lib/agent-mission-control/types'

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'TradeAgent',
    slug: 'tradeagent',
    description: 'Trading desk copilots',
    platform: 'web',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function copilot(overrides: Partial<Copilot> = {}): Copilot {
  return {
    id: 'cop-1',
    projectId: 'proj-1',
    targetProjectIds: [],
    name: 'Market Intelligence',
    slug: 'market-intelligence',
    description: '',
    runtime: 'langgraph',
    status: 'active',
    productionVersionId: 'v1',
    latestVersionId: 'v1',
    model: 'gpt-5.4',
    modelProvider: 'openai',
    owner: 'aigent',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    health: {
      testPassRate: 1,
      benchmarkScore: 90,
      runsLast24h: 3,
      errorRateLast24h: 0,
      avgLatencyMs: 500,
      costLast24hUsd: 1.2,
    },
    healthUnavailableFields: [],
    healthEvidence: 'runs',
    displayStatus: 'production',
    ...overrides,
  }
}

describe('ProjectsScreen — project registry enrichment', () => {
  it('a project with a team and a real delivery renders the repo, the team and the delivery status', () => {
    const p = project({ repoFullName: 'hearst/tradeagent' })
    const agent = copilot({
      lastPushStatus: 'pushed',
      lastPushedAt: '2026-07-20T10:30:00.000Z',
      lastPushCommitUrl: 'https://github.com/hearst/tradeagent/commit/abc123',
    })

    render(<ProjectsScreen projects={[p]} copilots={[agent]} />)

    expect(screen.getByText('hearst/tradeagent')).toBeTruthy()
    // The delivery timestamp is rendered as a real link to the commit, never
    // a bare "deployed" claim — the label is the neutral "pushed".
    const link = screen.getByRole('link', { name: '2026-07-20 10:30' })
    expect(link.getAttribute('href')).toBe('https://github.com/hearst/tradeagent/commit/abc123')
    expect(screen.getByText('pushed')).toBeTruthy()
  })

  it('a project with no linked repo renders "not configured", never a blank cell or a fabricated value', () => {
    const p = project({ repoFullName: undefined })

    render(<ProjectsScreen projects={[p]} copilots={[]} />)

    expect(screen.getByText('not configured')).toBeTruthy()
  })

  it('a project with a team but no recorded push renders "no delivery yet", a measured absence — not "Indisponible"', () => {
    const p = project({ repoFullName: 'hearst/tradeagent' })
    const agent = copilot({ lastPushStatus: undefined, lastPushedAt: undefined })

    render(<ProjectsScreen projects={[p]} copilots={[agent]} />)

    expect(screen.getByText('no delivery yet')).toBeTruthy()
  })

  it('the consumer-side version drift is disclosed as structurally unknown, never derived from a delivery', () => {
    const p = project({ repoFullName: 'hearst/tradeagent' })
    const agent = copilot({
      lastPushStatus: 'pushed',
      lastPushedAt: '2026-07-20T10:30:00.000Z',
    })

    render(<ProjectsScreen projects={[p]} copilots={[agent]} />)

    expect(
      screen.getByText(
        'Consumer-side active version and version drift are not readable by Aigent — a delivery above only proves a push landed, not what the consumer runs.'
      )
    ).toBeTruthy()
  })

  it('a failed agent registry read renders every agent figure as unavailable, and the delivery column follows suit', () => {
    const p = project({ repoFullName: 'hearst/tradeagent' })

    render(<ProjectsScreen projects={[p]} copilots={null} agentsErrorDetail="PostgREST timeout" />)

    expect(screen.getByText('Agent registry could not be read')).toBeTruthy()
    expect(screen.getAllByText('Indisponible').length).toBeGreaterThan(0)
  })
})
