import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { OverviewScreen } from '@/components/console/overview-screen'
import type { ActionItem, DashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'

function overview(partial: Partial<DashboardOverview> = {}): DashboardOverview {
  return {
    kpis: {
      productionAgents: 2,
      readyForManualTest: 0,
      sandboxPassRate: null,
      avgRepoFit: null,
      blockedDeliveries: 0,
      executableNow: 1,
      executableTotal: 2,
      runs24h: 0,
      success24h: null,
      cost24h: null,
      needsAction: 0,
    },
    projects: [],
    actionItems: [],
    dataWarnings: [],
    windowRuns: [],
    telemetryHealth: {
      status: 'not_configured',
      summary: 'Runtime telemetry ingestion is not configured.',
      daysSinceLastEvent: null,
      agentsWithTelemetryDeclared: null,
    },
    telemetryReportingAgents: null,
    telemetryRunsMeasured: null,
    recentDeliveries: [],
    pendingArchitectApprovals: [],
    recentTelemetryEvents: [],
    ...partial,
  }
}

function actionItem(partial: Partial<ActionItem> = {}): ActionItem {
  return {
    id: 'a1',
    kind: 'ready_manual',
    title: 'Ready for manual test',
    meta: 'Agent X · adrien-debug/repo',
    status: 'ready_for_manual_test',
    href: '/admin/agents/x',
    buttonLabel: 'Review',
    priority: 1,
    ...partial,
  }
}

describe('overview redesign structure', () => {
  it('mounts the four operator zones', () => {
    render(<OverviewScreen overview={overview()} />)
    expect(screen.getByTestId('overview-operating-state')).toBeTruthy()
    expect(screen.getByTestId('overview-action-queue')).toBeTruthy()
    expect(screen.getByTestId('overview-run-activity')).toBeTruthy()
    expect(screen.getByTestId('overview-telemetry')).toBeTruthy()
    expect(screen.getByTestId('overview-deliveries')).toBeTruthy()
  })

  it('does not render an isolated success RingGauge', () => {
    const { container } = render(
      <OverviewScreen overview={overview({ kpis: { ...overview().kpis, success24h: 80 } })} />
    )
    expect(container.querySelectorAll('svg[aria-label*="Success rate over the last 24 hours"]')).toHaveLength(0)
  })

  it('surfaces action queue items with navigable buttons', () => {
    render(<OverviewScreen overview={overview({ actionItems: [actionItem()], kpis: { ...overview().kpis, needsAction: 1 } })} />)
    const queue = screen.getByTestId('overview-action-queue')
    expect(within(queue).getByText('Ready for manual test')).toBeTruthy()
    expect(within(queue).getByRole('link', { name: 'Review' })).toBeTruthy()
  })

  it('uses contextual empty states', () => {
    render(<OverviewScreen overview={overview()} />)
    expect(screen.getByText('No operator action required')).toBeTruthy()
    expect(screen.getByText('No delivery recorded yet')).toBeTruthy()
    expect(screen.getByText('No runtime telemetry event recorded yet')).toBeTruthy()
  })

  it('telemetry events expose provenance as separate fields', () => {
    render(
      <OverviewScreen
        overview={overview({
          recentTelemetryEvents: [
            {
              id: 'e1',
              projectId: 'proj',
              agentId: 'agent-1',
              agentVersion: null,
              targetRepo: null,
              runId: 'r1',
              provider: 'openai',
              model: 'gpt-5.4',
              status: 'completed',
              latencyMs: 1,
              inputShape: {},
              outputShape: {},
              error: {},
              usage: {},
              environment: { source: 'aigent-internal-runner' },
              receivedAt: '2026-07-30T12:00:00.000Z',
            },
          ],
        })}
      />
    )
    const panel = screen.getByTestId('overview-telemetry')
    expect(within(panel).getByText('Provenance')).toBeTruthy()
    expect(within(panel).getByText('agent-1')).toBeTruthy()
    expect(within(panel).queryByText(/internal · proj/)).toBeNull()
  })
})
