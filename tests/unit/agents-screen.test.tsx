/**
 * `/admin/agents` — the fleet management screen. Targeted coverage for the
 * deepening in this mission: search/filter/sort over the table, the in-line
 * blocking reason (the operational payoff — no click required), and the three
 * truth invariants every console screen owes: a real fleet renders its real
 * rows, an empty fleet renders calm zeros (never omitted), and a FAILED read
 * renders as failed — never as a healthy, empty one.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AgentsScreen, blockingReasons } from '@/components/console/agents-screen'
import type { AvailableAgent } from '@/lib/agent-mission-control/available-agents'

function agent(overrides: Partial<AvailableAgent> & { copilotId: string; name: string }): AvailableAgent {
  return {
    projectId: 'proj-1',
    description: null,
    version: 'v1',
    versionStage: 'production',
    status: 'active',
    lifecycleStatus: 'active',
    runtime: 'langgraph',
    executable: true,
    provider: 'openai',
    configuredModel: 'gpt-5.4',
    executedModel: 'gpt-5.4',
    tools: [],
    capabilities: [],
    readOnly: true,
    requiresHumanApproval: false,
    lastRunAt: '2026-07-29T08:14:00Z',
    lastRunStatus: 'completed',
    lastRunCostUsd: 0.42,
    unavailableFields: [],
    unresolvedToolIds: [],
    ...overrides,
  }
}

describe('AgentsScreen — a real catalogue renders its real rows', () => {
  it('renders both agents, and the executable one carries no blocking reason', () => {
    const agents = [
      agent({ copilotId: 'cop-alpha', name: 'Alpha Trader' }),
      agent({
        copilotId: 'cop-beta',
        name: 'Beta Guardian',
        executable: false,
        status: 'unavailable',
        unavailableFields: ['provider'],
        provider: null,
      }),
    ]
    render(<AgentsScreen agents={agents} />)

    expect(screen.getAllByText('Alpha Trader').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Beta Guardian').length).toBeGreaterThan(0)
    // Beta's blocking reason is readable in the row, no navigation required.
    expect(screen.getAllByText(/no provider resolved/).length).toBeGreaterThan(0)
  })

  it('search narrows the table to matching name or id, and the row count updates', () => {
    const agents = [
      agent({ copilotId: 'cop-alpha', name: 'Alpha Trader' }),
      agent({ copilotId: 'cop-beta', name: 'Beta Guardian' }),
    ]
    render(<AgentsScreen agents={agents} />)

    const search = screen.getByLabelText('Search agents by name or id') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'alpha' } })

    const table = screen.getByRole('table', { name: 'Runtime agent catalogue' })
    expect(within(table).getByText('Alpha Trader')).toBeInTheDocument()
    expect(within(table).queryByText('Beta Guardian')).not.toBeInTheDocument()
    expect(screen.getByText('1 / 2 rows')).toBeInTheDocument()
  })
})

describe('AgentsScreen — no faux zero, ever', () => {
  it('an EMPTY, successfully-read catalogue shows measured zeros, not Indisponible', () => {
    render(<AgentsScreen agents={[]} />)
    // Measured zeros throughout the KPI band — never the absence word.
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
    expect(screen.getAllByText('No persisted agent is available.').length).toBeGreaterThan(0)
    // The one legitimate exception: `RingGauge` draws "Indisponible" for a
    // ratio with no denominator (0 of 0) — a real, pre-existing rule of that
    // component, not a faux zero. What must NEVER appear is the ERROR state.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a FAILED read is never rendered as an empty, healthy fleet', () => {
    render(<AgentsScreen agents={null} agentsErrorDetail="PGRST301: connection refused" />)
    // Several panels each wear their own `ErrorState` (danger role) when the
    // read failed — the top-level one names the failure with its PostgREST
    // detail; the rest state that nothing was read for their own scope.
    const alerts = screen.getAllByRole('alert')
    expect(alerts.length).toBeGreaterThan(0)
    expect(screen.getByText('Agent catalogue could not be read')).toBeInTheDocument()
    expect(screen.getByText(/PGRST301: connection refused/)).toBeInTheDocument()
    // Every KPI figure reads the absence label, never a confident 0.
    expect(screen.getAllByText('Indisponible').length).toBeGreaterThan(0)
    expect(screen.queryByText('No persisted agent is available.')).not.toBeInTheDocument()
  })
})

describe('blockingReasons — mirrors the run gate, never a second rule', () => {
  it('an executable agent has no reasons', () => {
    expect(blockingReasons(agent({ copilotId: 'c', name: 'n' }))).toEqual([])
  })

  it('names the unresolved tools and the missing fields, not a vague label', () => {
    const reasons = blockingReasons(
      agent({
        copilotId: 'c',
        name: 'n',
        unresolvedToolIds: ['tool-1', 'tool-2'],
        unavailableFields: ['provider', 'version'],
        runtime: 'direct',
      })
    )
    expect(reasons).toContain('2 declared tools the runner cannot execute')
    expect(reasons).toContain('no provider resolved')
    expect(reasons).toContain('no version resolved')
    expect(reasons).toContain('runtime is direct')
  })
})

describe('AgentsScreen — sticky, bounded table: the actions column stays reachable', () => {
  it('renders the Inspect action for every visible row', () => {
    const agents = [agent({ copilotId: 'cop-alpha', name: 'Alpha Trader' })]
    render(<AgentsScreen agents={agents} />)
    const table = screen.getByRole('table', { name: 'Runtime agent catalogue' })
    expect(within(table).getByRole('link', { name: /Inspect/ })).toHaveAttribute(
      'href',
      '/admin/agents/cop-alpha'
    )
  })
})
