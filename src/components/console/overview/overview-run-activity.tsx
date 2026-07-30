import { TrendChart, type TrendSeries } from '@/components/console/charts/trend-chart'
import { BarBreakdown, type BarBreakdownRow } from '@/components/console/charts/bar-breakdown'
import { cn } from '@/components/ui/cn'
import type { AgentRun, AgentRunStatus } from '@/lib/agent-mission-control/types'
import { consolePanelChrome } from '../console-variants'
import { ErrorState, Unavailable } from '../screen-primitives'
import { NoDataChart } from '../charts/no-data-chart'
import {
  RUN_STATUSES,
  RUNS_UNREAD_TITLE,
  countRunsByStatus,
  overviewTypography,
  runStatusTone,
  type TrendBuckets,
} from './overview-helpers'
import { StatusDot } from '@/components/ui/status-dot'

function statusRows(counts: Record<AgentRunStatus, number>): BarBreakdownRow[] {
  return RUN_STATUSES.map((status) => ({
    label: status,
    count: counts[status],
    danger: status === 'failed' || status === 'blocked',
  }))
}

export function OverviewRunActivity({
  runsUnread,
  trend,
  statusCounts,
  runs24h,
  success24h,
  className,
}: {
  runsUnread: boolean
  trend: TrendBuckets | null
  statusCounts: Record<AgentRunStatus, number> | null
  runs24h: number | null
  success24h: number | null
  className?: string
}) {
  const trendSeries: TrendSeries[] =
    trend === null || trend.xLabels.length === 0
      ? []
      : [
          { key: 'total', label: 'total runs', tone: 'muted', points: trend.total },
          { key: 'completed', label: 'completed', tone: 'accent', points: trend.completed },
          { key: 'failed', label: 'failed', tone: 'danger', points: trend.failed },
        ]

  const totalRuns = statusCounts
    ? RUN_STATUSES.reduce((sum, status) => sum + statusCounts[status], 0)
    : null

  return (
    <section
      className={cn(
        consolePanelChrome('secondary'),
        runsUnread && 'border-[var(--state-danger-solid-line)]',
        className
      )}
      data-testid="overview-run-activity"
    >
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <div>
          <h2 className={overviewTypography.zoneTitle}>Run activity · 24h</h2>
          <p className={cn('mt-0.5', overviewTypography.zoneDescription)}>
            Volume, outcomes and status mix across the observed window
          </p>
        </div>
        <dl className="flex flex-wrap gap-4 text-right">
          <div>
            <dt className={overviewTypography.secondaryLabel}>Volume</dt>
            <dd className={cn('mt-0.5', overviewTypography.secondaryMetric)}>
              {runs24h === null ? <Unavailable className="text-base/7" /> : runs24h}
            </dd>
          </div>
          <div>
            <dt className={overviewTypography.secondaryLabel}>Success</dt>
            <dd className={cn('mt-0.5', overviewTypography.secondaryMetric)}>
              {success24h === null ? <Unavailable className="text-base/7" /> : `${success24h}%`}
            </dd>
          </div>
        </dl>
      </header>

      {trend === null ? (
        <ErrorState
          title={RUNS_UNREAD_TITLE}
          description="Nothing can be plotted: the 24h run window was not read."
          className="m-4"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(220px,0.7fr)] lg:px-5">
          <div>
            {trendSeries.length === 0 ? (
              <NoDataChart
                label="No run in this window"
                detail="The window was read and held nothing — start a run from an agent to populate this view."
              />
            ) : (
              <TrendChart
                series={trendSeries}
                xLabels={trend.xLabels}
                height={200}
                showArea
                emptyMessage="No run was recorded in this window."
              />
            )}
          </div>
          <div className="min-w-0">
            <p className={cn('mb-2', overviewTypography.secondaryLabel)}>Status distribution</p>
            {statusCounts === null ? (
              <Unavailable />
            ) : (
              <>
                <BarBreakdown
                  rows={statusRows(statusCounts)}
                  total={Math.max(totalRuns ?? 0, 1)}
                  ariaLabel="Run status distribution for the 24h window"
                />
                <ul className="mt-2 space-y-1 border-t border-line px-4 pt-2">
                  {RUN_STATUSES.map((status) => (
                    <li key={status} className="flex items-center justify-between gap-2 text-sm/6">
                      <StatusDot tone={runStatusTone(status)}>{status}</StatusDot>
                      <span className="tabular-nums text-content">{statusCounts[status]}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
