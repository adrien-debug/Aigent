import { ArrowRightIcon } from '@heroicons/react/20/solid'

import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import type { DashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'
import { DegradedBanner } from './screen-primitives'
import { OverviewOperatingState } from '@/components/console/overview/overview-operating-state'
import { OverviewActionQueue } from '@/components/console/overview/overview-action-queue'
import { OverviewFleetHealth } from '@/components/console/overview/overview-fleet-health'
import { OverviewRunActivity } from '@/components/console/overview/overview-run-activity'
import { OverviewTelemetryPanel } from '@/components/console/overview/overview-telemetry-panel'
import { OverviewDeliveries } from '@/components/console/overview/overview-deliveries'
import {
  bucketRunsByStartTime,
  countRunsByStatus,
  RUNS_UNREAD_DETAIL,
} from '@/components/console/overview/overview-helpers'

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
    <div className="overview-editorial -m-3 min-h-[calc(100vh-3.25rem)] space-y-6 bg-[radial-gradient(1100px_380px_at_18%_-8%,rgba(118,236,85,0.16),transparent_62%),linear-gradient(180deg,#f5f6f1_0%,#efeee8_100%)] p-4 sm:-m-4 sm:p-7 lg:-m-5 lg:p-10">
      <header className="flex flex-col gap-5 border-b border-line pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="mb-3 text-[11px]/4 font-semibold uppercase tracking-[0.18em] text-accent-800">
            Agent mission control
          </p>
          <Heading className="text-[34px]/10 font-semibold tracking-[-0.035em] text-content sm:text-[42px]/12">
            Overview
          </Heading>
          <p className="mt-2 text-base/7 text-content-muted">
            What needs your attention now — serving agents, queue, activity and channel health.
          </p>
        </div>
        <div className="shrink-0">
          <Button href="/admin/runs" color="accent">
            Open runs <ArrowRightIcon />
          </Button>
        </div>
      </header>

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
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
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
