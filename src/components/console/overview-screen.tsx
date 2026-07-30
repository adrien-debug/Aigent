import { ArrowRightIcon } from '@heroicons/react/20/solid'

import { Button } from '@/components/ui/button'
import type { DashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'
import { DegradedBanner, ScreenHeader } from './screen-primitives'
import { OverviewOperatingState } from './overview/overview-operating-state'
import { OverviewActionQueue } from './overview/overview-action-queue'
import { OverviewFleetHealth } from './overview/overview-fleet-health'
import { OverviewRunActivity } from './overview/overview-run-activity'
import { OverviewTelemetryPanel } from './overview/overview-telemetry-panel'
import { OverviewDeliveries } from './overview/overview-deliveries'
import { bucketRunsByStartTime, countRunsByStatus, RUNS_UNREAD_DETAIL } from './overview/overview-helpers'

/**
 * Operator overview — `/admin`.
 *
 * Server component: one `DashboardOverview` read, four visual zones:
 * operating state → actions + fleet → run activity → telemetry + deliveries.
 */
export function OverviewScreen({ overview }: { overview: DashboardOverview }) {
  const { kpis } = overview
  const windowRuns = overview.windowRuns
  const runsUnread = windowRuns === null

  const trend = windowRuns === null ? null : bucketRunsByStartTime(windowRuns)
  const statusCounts = windowRuns === null ? null : countRunsByStatus(windowRuns)

  const cost24h = kpis.cost24h
  const costDetail =
    cost24h !== null
      ? cost24h.measuredRuns < cost24h.totalRuns
        ? `${cost24h.measuredRuns} of ${cost24h.totalRuns} runs priced`
        : 'All window runs priced'
      : windowRuns === null
        ? RUNS_UNREAD_DETAIL
        : windowRuns.length === 0
          ? 'No run in this window to cost'
          : 'No run in this window carried a measurable cost'

  const approvalsPending =
    overview.pendingArchitectApprovals === null ? null : overview.pendingArchitectApprovals.length

  const queueReadFailed =
    overview.pendingArchitectApprovals === null ||
    overview.actionItems.some((item) => item.kind === 'data_unavailable')

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <ScreenHeader
        title="Overview"
        description="What needs your attention now — serving agents, queue, activity and channel health."
        actions={
          <Button href="/admin/runs" color="accent">
            Open runs <ArrowRightIcon />
          </Button>
        }
      />

      <DegradedBanner messages={overview.dataWarnings} />

      {/* ZONE 1 — operating state */}
      <OverviewOperatingState kpis={kpis} runsUnread={runsUnread} costDetail={costDetail} />

      {/* ZONE 2 — actions + fleet */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <OverviewActionQueue items={overview.actionItems} readFailed={queueReadFailed} />
        <OverviewFleetHealth kpis={kpis} approvalsPending={approvalsPending} />
      </div>

      {/* ZONE 3 — run activity */}
      <OverviewRunActivity
        runsUnread={runsUnread}
        trend={trend}
        statusCounts={statusCounts}
        runs24h={kpis.runs24h}
        success24h={kpis.success24h}
      />

      {/* ZONE 4 — telemetry + deliveries */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <OverviewTelemetryPanel
          telemetryHealth={overview.telemetryHealth}
          reportingAgents={overview.telemetryReportingAgents}
          runsInFeed={overview.telemetryRunsMeasured}
          events={overview.recentTelemetryEvents}
        />
        <OverviewDeliveries deliveries={overview.recentDeliveries} />
      </div>
    </div>
  )
}
