/**
 * Unit tests — dashboard charts after the Recharts migration.
 *
 * Two things are worth locking down, and neither is cosmetic:
 *
 *  1. The charts actually RENDER. A build passing only proves the module
 *     compiles; Recharts needs a real DOM and fails at runtime, not build time.
 *  2. The truth semantics survived the engine swap. `CostOverTimeChart` must
 *     still refuse to draw a flat zero line when no run carries a measured cost
 *     (`costUsd === null`) — a zero would read as "we measured $0", which is a
 *     fabricated datum, not missing data.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CostOverTimeChart } from '@/components/agent-ops/dashboard-charts/cost-over-time-chart'
import { RunsOverTimeChart } from '@/components/agent-ops/dashboard-charts/runs-over-time-chart'
import { bucketRunsByHour } from '@/components/agent-ops/dashboard-charts/chart-frame'
import type { AgentRun, AgentRunStatus } from '@/lib/agent-mission-control/types'

const NOW = Date.parse('2026-07-26T12:00:00.000Z')

function run(partial: Partial<AgentRun> & Pick<AgentRun, 'id'>): AgentRun {
  return {
    status: 'completed' as AgentRunStatus,
    startedAt: new Date(NOW - 30 * 60_000).toISOString(),
    costUsd: null,
    ...partial,
  } as AgentRun
}

describe('bucketRunsByHour', () => {
  it('drops runs outside the 24h window and keeps the histogram total honest', () => {
    const buckets = bucketRunsByHour(
      [
        run({ id: 'in-window' }),
        run({ id: 'too-old', startedAt: new Date(NOW - 40 * 3_600_000).toISOString() }),
      ],
      NOW,
    )

    expect(buckets).toHaveLength(24)
    expect(buckets.reduce((s, b) => s + b.total, 0)).toBe(1)
  })

  it('splits completed / failed / other so the legend cannot contradict the bars', () => {
    const buckets = bucketRunsByHour(
      [
        run({ id: 'a', status: 'completed' }),
        run({ id: 'b', status: 'failed' }),
        run({ id: 'c', status: 'running' }),
      ],
      NOW,
    )

    const sum = (k: 'completed' | 'failed' | 'other') => buckets.reduce((s, b) => s + b[k], 0)
    expect(sum('completed')).toBe(1)
    expect(sum('failed')).toBe(1)
    expect(sum('other')).toBe(1)
  })
})

describe('RunsOverTimeChart', () => {
  it('renders the Recharts plot with an accessible summary', () => {
    render(<RunsOverTimeChart runs={[run({ id: 'a', status: 'completed' })]} nowMs={NOW} />)

    expect(screen.getByRole('img', { name: /Hourly runs for the last 24 hours/i })).toBeTruthy()
  })

  it('says so plainly when the window is empty — no chart chrome around nothing', () => {
    render(<RunsOverTimeChart runs={[]} nowMs={NOW} />)

    // The empty branch now uses the SHARED EmptyState (role="status"), like the
    // three sibling charts, instead of a bespoke dot-plus-sentence — so assert on
    // the role as well as the copy: it is the role that makes the two cards of a
    // dashboard row the same shape, and a silent regression to a bare <span>
    // would otherwise pass on the text alone.
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByText(/No runs in the last 24h/i)).toBeTruthy()
    expect(screen.queryByRole('img', { name: /Hourly runs/i })).toBeNull()
  })
})

describe('CostOverTimeChart', () => {
  it('renders the area chart when at least one run carries a measured cost', () => {
    render(<CostOverTimeChart runs={[run({ id: 'a', costUsd: 0.25 })]} nowMs={NOW} />)

    expect(screen.getByRole('img', { name: /Hourly measured cost/i })).toBeTruthy()
  })

  it('refuses a flat zero line when no run has measured cost (costUsd === null)', () => {
    // Runs EXIST in the window — they just never reported usage. Drawing a zero
    // line here would assert "$0 measured", which is a fabricated datum.
    render(<CostOverTimeChart runs={[run({ id: 'a' }), run({ id: 'b' })]} nowMs={NOW} />)

    expect(screen.getByText(/No measured cost in the last 24h/i)).toBeTruthy()
    expect(screen.queryByRole('img', { name: /Hourly measured cost/i })).toBeNull()
  })

  it('sums only measured runs — a null-cost run must not dilute the total', () => {
    render(<CostOverTimeChart runs={[run({ id: 'a', costUsd: 1.5 }), run({ id: 'b' })]} nowMs={NOW} />)

    expect(screen.getByText(/\$1\.50 total/)).toBeTruthy()
    expect(screen.getByText(/1 run measured/)).toBeTruthy()
  })
})
