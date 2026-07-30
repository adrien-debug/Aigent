/**
 * Sub-agent F — the console's expanded state vocabulary
 * (`src/components/console/states.tsx`, `src/components/console/charts/{chart-card,no-data-chart}.tsx`).
 *
 * Proves the thing the mission exists to fix: six situations that used to
 * collapse into "empty grey paragraph" now render as visually and textually
 * DISTINCT markup, `ChartCard` actually swaps to the compact `NoDataChart`
 * frame on an empty series (never the tall populated one), the chart
 * placeholder stays compact rather than growing into a big empty rectangle,
 * and no sparkline sneaks into any of it.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  CompactMetric,
  ConfigurationRequired,
  DataUnavailable,
  EmptyStateIllustrated,
  ErrorStateBlocking,
  EvidenceMissing,
  LoadingSkeleton,
} from '@/components/console/states'
import { ChartCard } from '@/components/console/charts/chart-card'
import { NoDataChart } from '@/components/console/charts/no-data-chart'

describe('the six states render distinctly', () => {
  it('EmptyStateIllustrated: dashed frame, requires reason + source, no danger role', () => {
    const { container } = render(
      <EmptyStateIllustrated title="No runs in this window" reason="No agent has run yet." source="runs_console" />
    )
    expect(screen.getByText('No runs in this window')).toBeTruthy()
    expect(screen.getByText('No agent has run yet.')).toBeTruthy()
    expect(screen.getByText(/Source · runs_console/)).toBeTruthy()
    const frame = container.querySelector('.border-dashed')
    expect(frame).toBeTruthy()
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('ErrorStateBlocking: role=alert, danger frame, dominates — no children slot exists on its type', () => {
    render(<ErrorStateBlocking title="Read failed" description="The registry did not answer." />)
    const alert = screen.getByRole('alert')
    expect(alert.className).toContain('border-[var(--state-danger-solid-line)]')
    expect(alert.className).toContain('min-h-48')
    expect(screen.getByText('Read failed')).toBeTruthy()
  })

  it('LoadingSkeleton: bounded shapes, no spinner, capped at 8 rows', () => {
    const { container } = render(<LoadingSkeleton rows={99} />)
    const bars = container.querySelectorAll('.animate-pulse')
    expect(bars.length).toBe(8)
    expect(container.querySelector('[role="status"]')).toBeTruthy()
  })

  it('DataUnavailable: prints the literal UNAVAILABLE_LABEL, never a number', () => {
    render(<DataUnavailable label="24h cost" detail="Provider did not report this window." />)
    expect(screen.getByText('Indisponible')).toBeTruthy()
    expect(screen.queryByText('0')).toBeNull()
  })

  it('ConfigurationRequired: accent-tinted frame, action is required and rendered', () => {
    const { container } = render(
      <ConfigurationRequired
        title="Langfuse not configured"
        description="No observability key set for this project."
        action={<a href="/admin/projects/1/builder">Configure</a>}
      />
    )
    expect(container.querySelector('.border-\\[var\\(--accent-line\\)\\]')).toBeTruthy()
    expect(screen.getByText('Configure')).toBeTruthy()
  })

  it('EvidenceMissing: dotted frame, distinct from the dashed empty frame', () => {
    const { container } = render(<EvidenceMissing pipeline="bench" detail="No benchmark run has ever fired for this version." />)
    expect(container.querySelector('.border-dotted')).toBeTruthy()
    expect(container.querySelector('.border-dashed')).toBeNull()
    expect(screen.getByText(/No bench evidence yet/)).toBeTruthy()
  })

  it('CompactMetric: one dense line, not a card', () => {
    const { container } = render(<CompactMetric label="p95 latency" value="212 ms" />)
    const row = container.firstElementChild as HTMLElement
    expect(row.className).not.toContain('rounded-xl')
    expect(screen.getByText('212 ms')).toBeTruthy()
  })
})

describe('ChartCard bascule sur série vide', () => {
  it('renders children when isEmpty is false', () => {
    render(
      <ChartCard title="Runs / hour" source="runs_console" isEmpty={false}>
        <div data-testid="populated-plot">plot</div>
      </ChartCard>
    )
    expect(screen.getByTestId('populated-plot')).toBeTruthy()
  })

  it('swaps to the compact NoDataChart frame when isEmpty is true, never rendering the children', () => {
    render(
      <ChartCard title="Runs / hour" source="runs_console" isEmpty emptyDetail="No interval observed.">
        <div data-testid="populated-plot">plot</div>
      </ChartCard>
    )
    expect(screen.queryByTestId('populated-plot')).toBeNull()
    expect(screen.getByText('No data to plot')).toBeTruthy()
    expect(screen.getByText('No interval observed.')).toBeTruthy()
  })

  it('carries a bounded max-h- rung on its body — a chart frame never grows with its data', () => {
    const { container } = render(
      <ChartCard title="Runs / hour" source="runs_console" isEmpty={false}>
        <div>plot</div>
      </ChartCard>
    )
    const body = container.querySelector('.px-3.py-3')
    expect(body).toBeTruthy()
    expect(Array.from(body!.classList).some((c) => c.startsWith('max-h-'))).toBe(true)
  })
})

describe('NoDataChart stays compact — never a big empty rectangle', () => {
  it('renders at the fixed h-24 rung, not a tall plate', () => {
    const { container } = render(<NoDataChart />)
    const frame = container.firstElementChild as HTMLElement
    expect(frame.className).toContain('h-24')
    expect(frame.className).not.toMatch(/h-(64|72|80|96)\b/)
  })
})

describe('no sparkline anywhere in this library', () => {
  it('none of the six states nor the chart frame render an inline <svg>', () => {
    const { container: c1 } = render(<EmptyStateIllustrated title="t" reason="r" source="s" />)
    const { container: c2 } = render(<ErrorStateBlocking title="t" description="d" />)
    const { container: c3 } = render(<LoadingSkeleton />)
    const { container: c4 } = render(<DataUnavailable label="l" detail="d" />)
    const { container: c5 } = render(
      <ConfigurationRequired title="t" description="d" action={<span>go</span>} />
    )
    const { container: c6 } = render(<EvidenceMissing pipeline="test" detail="d" />)
    const { container: c7 } = render(<NoDataChart />)
    for (const container of [c1, c2, c3, c4, c5, c6, c7]) {
      expect(container.querySelector('svg')).toBeNull()
    }
  })
})
