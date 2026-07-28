/**
 * AIGENT-FRONTEND-RESET-001 — the runs cockpit as the operator sees it.
 *
 * These assert the TRUTHFULNESS contract at the rendering layer: absent values
 * stay visibly absent, a rate with no denominator says "Not measured", a
 * degraded read is disclosed, and the desktop table and the mobile card list
 * carry the same fields (no data silently dropped on small screens).
 */
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const replace = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin-v2/runs',
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}))

import { RunsView } from '@/components/runs-console/runs-view'
import { DEFAULT_RUNS_FILTERS } from '@/lib/runs-console/runs-filters'
import type { RunsPageData } from '@/lib/runs-console/runs-page-data'
import type { AgentRun } from '@/lib/agent-mission-control/types'
import { AGENT_NAMES, NOW_MS, PROJECT_NAMES, makeCopilot, makeRun } from './runs-fixtures'

function pageData(runs: AgentRun[], overrides: Partial<RunsPageData> = {}): RunsPageData {
  return {
    nowIso: new Date(NOW_MS).toISOString(),
    nowMs: NOW_MS,
    runs,
    copilotById: new Map([[makeCopilot().id, makeCopilot()]]),
    agentNameById: AGENT_NAMES,
    projectNameById: PROJECT_NAMES,
    viewer: { role: 'admin', authenticated: true },
    degraded: [],
    degradedDetail: null,
    windowRunCount: runs.length,
    windowTruncated: false,
    windowMaxRows: 1000,
    tableRowCap: 200,
    ...overrides,
  }
}

function renderView(data: RunsPageData, filters = DEFAULT_RUNS_FILTERS) {
  return render(<RunsView data={data} initialFilters={filters} />)
}

/** The desktop table; the mobile card list renders the same rows separately. */
function table() {
  return screen.getByRole('table')
}

describe('RunsView — data rendering', () => {
  it('renders a run with its agent, project, model and cost', () => {
    renderView(pageData([makeRun()]))

    const row = within(table()).getAllByRole('row')[1]!
    expect(within(row).getByRole('link', { name: 'Market Intelligence' })).toHaveAttribute(
      'href',
      '/admin/agents/copilot-market-intelligence'
    )
    expect(within(row).getByRole('link', { name: 'TradeAgent' })).toHaveAttribute(
      'href',
      '/admin/projects/proj-tradeagent'
    )
    expect(within(row).getByText(/gpt-5\.4/)).toBeInTheDocument()
    expect(within(row).getByText('$0.0246')).toBeInTheDocument()
  })

  it('links each run to the existing agent run detail', () => {
    renderView(pageData([makeRun({ id: 'run-abc-123' })]))

    const link = within(table()).getByRole('link', { name: 'run-abc-' })
    expect(link).toHaveAttribute(
      'href',
      '/admin/agents/copilot-market-intelligence/runs?run=run-abc-123'
    )
  })

  it('shows "Not measured" for a null cost instead of a zero', () => {
    renderView(pageData([makeRun({ costUsd: null })]))

    expect(within(table()).getByText('Not measured')).toBeInTheDocument()
    expect(within(table()).queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('marks an unproven model as Unverified rather than guessing one', () => {
    renderView(
      pageData([makeRun({ resolvedModel: null, resolvedProvider: null, modelUnverified: undefined })])
    )

    expect(within(table()).getAllByText('Unverified').length).toBeGreaterThan(0)
  })

  it('marks a model that exists but was never verified', () => {
    renderView(pageData([makeRun({ resolvedModel: 'gpt-5.4', modelUnverified: true })]))

    const row = within(table()).getAllByRole('row')[1]!
    expect(within(row).getByText('gpt-5.4')).toBeInTheDocument()
    expect(within(row).getByText('Unverified')).toBeInTheDocument()
  })

  it('falls back to a Detail action when a run has no trace', () => {
    renderView(pageData([makeRun({ traceUrl: null })]))

    expect(within(table()).getByRole('link', { name: 'Detail' })).toBeInTheDocument()
    expect(within(table()).queryByRole('link', { name: 'Trace' })).not.toBeInTheDocument()
  })

  it('renders an em dash for a missing latency instead of 0ms', () => {
    renderView(pageData([makeRun({ latencyMs: Number.NaN })]))

    const row = within(table()).getAllByRole('row')[1]!
    expect(within(row).queryByText('0ms')).not.toBeInTheDocument()
  })

  it('surfaces unsafe attempts next to the tool count', () => {
    renderView(pageData([makeRun({ unsafeAttemptCount: 2 })]))

    expect(within(table()).getByText('+2 unsafe')).toBeInTheDocument()
  })

  it('shows the raw agent id when the name could not be resolved', () => {
    renderView(pageData([makeRun({ copilotId: 'copilot-unknown' })]))

    expect(
      within(table()).getByRole('link', { name: 'copilot-unknown' })
    ).toBeInTheDocument()
  })
})

describe('RunsView — KPI and success rate', () => {
  it('derives the KPI figures from the runs actually in view', () => {
    renderView(
      pageData([
        makeRun({ id: 'a', status: 'completed' }),
        makeRun({ id: 'b', status: 'failed' }),
        makeRun({ id: 'c', status: 'running' }),
      ])
    )

    const summary = screen.getByRole('region', { name: 'Runs' })
    expect(within(summary).getByText('Runs in period').nextSibling).toHaveTextContent('3')
    expect(within(summary).getByText('Completed').nextSibling).toHaveTextContent('1')
    expect(within(summary).getByText('Failed / blocked').nextSibling).toHaveTextContent('1')
  })

  it('shows the success rate when runs have finished', () => {
    renderView(
      pageData([
        makeRun({ id: 'a', status: 'completed' }),
        makeRun({ id: 'b', status: 'failed' }),
      ])
    )

    const ring = screen.getByRole('region', { name: 'Success rate' })
    expect(within(ring).getByText('50%')).toBeInTheDocument()
  })

  it('says "Not measured" — never 0% — when nothing has finished', () => {
    renderView(pageData([makeRun({ status: 'running' })]))

    const ring = screen.getByRole('region', { name: 'Success rate' })
    expect(within(ring).getByText('Not measured')).toBeInTheDocument()
    expect(within(ring).queryByText('0%')).not.toBeInTheDocument()
  })

  it('reports the measured cost and how many runs had none', () => {
    renderView(pageData([makeRun({ costUsd: 0.02 }), makeRun({ id: 'b', costUsd: null })]))

    const summary = screen.getByRole('region', { name: 'Runs' })
    expect(within(summary).getByText('$0.02')).toBeInTheDocument()
    expect(within(summary).getByText(/1 run without a measured cost/)).toBeInTheDocument()
  })

  it('shows "Not measured" for cost when no run had one', () => {
    renderView(pageData([makeRun({ costUsd: null })]))

    const summary = screen.getByRole('region', { name: 'Runs' })
    expect(within(summary).getByText('Not measured')).toBeInTheDocument()
  })
})

describe('RunsView — filters', () => {
  it('narrows the feed from the search carried by the URL', () => {
    // The search input lives in the shell topbar and writes `?q=`; the view
    // receives it through `initialFilters`. There is deliberately no second
    // input here, so the two surfaces cannot disagree.
    renderView(
      pageData([
        makeRun({ id: 'run-eth', inputSummary: 'ETH regime' }),
        makeRun({ id: 'run-btc', inputSummary: 'BTC funding' }),
      ]),
      { ...DEFAULT_RUNS_FILTERS, q: 'BTC' }
    )

    expect(within(table()).getByText('run-btc')).toBeInTheDocument()
    expect(within(table()).queryByText('run-eth')).not.toBeInTheDocument()
  })

  it('narrows by status', async () => {
    renderView(
      pageData([
        makeRun({ id: 'run-ok', status: 'completed' }),
        makeRun({ id: 'run-ko', status: 'failed' }),
      ])
    )

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'failed')

    expect(within(table()).getByText('run-ko')).toBeInTheDocument()
    expect(within(table()).queryByText('run-ok')).not.toBeInTheDocument()
  })

  it('recomputes the KPI figures from the filtered set, not the loaded set', async () => {
    renderView(
      pageData([
        makeRun({ id: 'run-ok', status: 'completed' }),
        makeRun({ id: 'run-ko', status: 'failed' }),
      ])
    )

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'failed')

    const summary = screen.getByRole('region', { name: 'Runs' })
    expect(within(summary).getByText('Runs in period').nextSibling).toHaveTextContent('1')
    // 0 completed of 1 finished — the ring must follow the same filtered set.
    const ring = screen.getByRole('region', { name: 'Success rate' })
    expect(within(ring).getByText('0%')).toBeInTheDocument()
  })

  it('only offers filter values that actually occur in the loaded runs', () => {
    renderView(pageData([makeRun()]))

    const agentSelect = screen.getByLabelText('Agent')
    expect(within(agentSelect).getByRole('option', { name: 'Market Intelligence' })).toBeInTheDocument()
    expect(within(agentSelect).getAllByRole('option')).toHaveLength(2) // All + the one agent
  })

  it('shows the filtered-empty state and clears back to the full list', async () => {
    renderView(pageData([makeRun({ id: 'run-eth' })]), {
      ...DEFAULT_RUNS_FILTERS,
      q: 'nothing-matches',
    })

    expect(screen.getByText('No run matches these filters')).toBeInTheDocument()

    // Two reset affordances coexist by design: the persistent one in the filter
    // bar and the primary call to action inside the empty state.
    const resets = screen.getAllByRole('button', { name: 'Clear filters' })
    expect(resets).toHaveLength(2)
    await userEvent.click(resets[1]!)
    expect(within(table()).getByText('run-eth')).toBeInTheDocument()
  })

  it('distinguishes "no run at all" from "filters exclude everything"', () => {
    renderView(pageData([]))

    expect(screen.getByText('No operational run in this window')).toBeInTheDocument()
    expect(screen.queryByText('No run matches these filters')).not.toBeInTheDocument()
  })

  it('starts from the filters carried by the URL', () => {
    renderView(
      pageData([
        makeRun({ id: 'run-ok', status: 'completed' }),
        makeRun({ id: 'run-ko', status: 'failed' }),
      ]),
      { ...DEFAULT_RUNS_FILTERS, status: 'failed' }
    )

    expect(within(table()).getByText('run-ko')).toBeInTheDocument()
    expect(within(table()).queryByText('run-ok')).not.toBeInTheDocument()
  })
})

/**
 * The WRITE side of the URL contract. Without these, deleting the sync effect
 * left every gate green while an operator who filtered and copied the address
 * bar sent a colleague to the unfiltered fleet — the read side alone
 * (`initialFilters`) cannot catch that.
 */
describe('RunsView — filters persist in the URL', () => {
  beforeEach(() => {
    replace.mockClear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function flushUrlSync() {
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
  }

  it('writes the status filter to the query string', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderView(pageData([makeRun({ status: 'failed' })]))

    await user.selectOptions(screen.getByLabelText('Status'), 'failed')
    await flushUrlSync()

    expect(replace).toHaveBeenCalledWith('/admin-v2/runs?status=failed', { scroll: false })
  })

  it('writes a non-default period, and omits it when it is the default', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderView(pageData([makeRun()]))

    await user.selectOptions(screen.getByLabelText('Period'), '1h')
    await flushUrlSync()
    expect(replace).toHaveBeenCalledWith('/admin-v2/runs?period=1h', { scroll: false })

    await user.selectOptions(screen.getByLabelText('Period'), '24h')
    await flushUrlSync()
    // Back to the default: the query string must be dropped, not left stale.
    expect(replace).toHaveBeenCalledWith('/admin-v2/runs', { scroll: false })
  })

  it('clears the query string when the filters are reset', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderView(pageData([makeRun({ status: 'failed' })]), {
      ...DEFAULT_RUNS_FILTERS,
      status: 'failed',
    })

    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!)
    await flushUrlSync()

    expect(replace).toHaveBeenCalledWith('/admin-v2/runs', { scroll: false })
  })

  it('re-applies the URL when a navigation changes it under the component', () => {
    const data = pageData([
      makeRun({ id: 'run-ok', status: 'completed' }),
      makeRun({ id: 'run-ko', status: 'failed' }),
    ])
    const { rerender } = render(
      <RunsView data={data} initialFilters={{ ...DEFAULT_RUNS_FILTERS, status: 'failed' }} />
    )
    expect(within(table()).queryByText('run-ok')).not.toBeInTheDocument()

    // Same route, cleared search params (what clicking "Runs" in the rail does).
    // Next does not remount on a search-param-only navigation, so the component
    // must adopt the new URL itself or the address bar and the table diverge.
    rerender(<RunsView data={data} initialFilters={DEFAULT_RUNS_FILTERS} />)

    expect(within(table()).getByText('run-ok')).toBeInTheDocument()
    expect(within(table()).getByText('run-ko')).toBeInTheDocument()
  })
})

describe('RunsView — partial data', () => {
  it('discloses a degraded catalogue read instead of pretending labels resolved', () => {
    renderView(
      pageData([makeRun({ copilotId: 'copilot-unknown' })], {
        agentNameById: new Map(),
        degraded: ['agents'],
        degradedDetail: 'agents: connection refused',
      })
    )

    // Two live regions coexist by design: this banner and the result counter.
    const banner = screen
      .getAllByRole('status')
      .find((el) => /Partial data/.test(el.textContent ?? ''))
    expect(banner).toBeDefined()
    expect(banner).toHaveTextContent(/agents/)
  })

  it('shows no partial-data banner on a healthy read', () => {
    renderView(pageData([makeRun()]))

    const banner = screen
      .getAllByRole('status')
      .find((el) => /Partial data/.test(el.textContent ?? ''))
    expect(banner).toBeUndefined()
  })
})

describe('RunsView — activity panel', () => {
  it('ranks the agents behind the runs currently in view', () => {
    renderView(
      pageData([
        makeRun({ id: 'a' }),
        makeRun({ id: 'b' }),
        makeRun({ id: 'c', copilotId: 'copilot-risk' }),
      ])
    )

    const panel = screen.getByRole('region', { name: 'Most active agents' })
    const links = within(panel).getAllByRole('link')
    // Busiest first: 2 runs for Market Intelligence, 1 for the other agent.
    expect(links[0]).toHaveTextContent('Market Intelligence')
    expect(links[0]).toHaveTextContent('2 runs')
  })

  it('follows the filters, so the panel cannot contradict the table', async () => {
    renderView(
      pageData([
        makeRun({ id: 'a', status: 'completed' }),
        makeRun({ id: 'b', status: 'failed', copilotId: 'copilot-risk' }),
      ])
    )

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'failed')

    const panel = screen.getByRole('region', { name: 'Most active agents' })
    expect(within(panel).getAllByRole('link')).toHaveLength(1)
    expect(within(panel).getByText(/1 failed/)).toBeInTheDocument()
  })
})

describe('RunsView — mobile parity', () => {
  it('renders the same essential fields and actions in the mobile card list', () => {
    renderView(pageData([makeRun({ id: 'run-mobile', costUsd: null, traceUrl: null })]))

    // The card list is the non-table rendering of the same rows.
    const cards = screen.getByRole('list', { name: 'Runs' })
    const card = within(cards).getAllByRole('listitem')[0]!

    expect(within(card).getByText('Market Intelligence')).toBeInTheDocument()
    expect(within(card).getByText('Model')).toBeInTheDocument()
    expect(within(card).getByText('Tools')).toBeInTheDocument()
    expect(within(card).getByText('Latency')).toBeInTheDocument()
    expect(within(card).getByText('Cost')).toBeInTheDocument()
    expect(within(card).getByText('Not measured')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Run detail' })).toBeInTheDocument()
  })
})
