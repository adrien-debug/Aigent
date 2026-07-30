import { cn } from '@/components/ui/cn'
import type { DashboardKpis } from '@/lib/agent-mission-control/dashboard-overview'
import { formatUsd } from '@/lib/agent-mission-control/format'
import { consolePanelChrome } from '../console-variants'
import { Unavailable } from '../screen-primitives'
import { OVERVIEW_WINDOW_LABEL, RUNS_UNREAD_DETAIL, overviewTypography } from './overview-helpers'

type SecondaryMetric = {
  label: string
  value: React.ReactNode
  detail: string
}

export function OverviewOperatingState({
  kpis,
  runsUnread,
  costDetail,
  className,
}: {
  kpis: DashboardKpis
  runsUnread: boolean
  costDetail: string
  className?: string
}) {
  const executable =
    kpis.executableNow !== null && kpis.executableTotal !== null
      ? { now: kpis.executableNow, total: kpis.executableTotal }
      : null

  const cost24h = kpis.cost24h

  const secondary: SecondaryMetric[] = [
    {
      label: 'Executable',
      value:
        executable === null ? (
          <Unavailable className="text-base/7" />
        ) : (
          <span>
            {executable.now}
            <span className="text-base/7 font-normal text-content-muted"> / {executable.total}</span>
          </span>
        ),
      detail: 'Would pass run gate now',
    },
    {
      label: 'Needs action',
      value: kpis.needsAction,
      detail: 'Operator queue depth',
    },
    {
      label: 'Runs',
      value: kpis.runs24h === null ? <Unavailable className="text-base/7" /> : kpis.runs24h,
      detail: runsUnread ? RUNS_UNREAD_DETAIL : OVERVIEW_WINDOW_LABEL,
    },
    {
      label: 'Success',
      value: kpis.success24h === null ? <Unavailable className="text-base/7" /> : `${kpis.success24h}%`,
      detail: runsUnread ? RUNS_UNREAD_DETAIL : 'Terminal runs only',
    },
    {
      label: 'Cost',
      value: cost24h === null ? <Unavailable className="text-base/7" /> : formatUsd(cost24h.usd),
      detail: costDetail,
    },
  ]

  return (
    <section className={cn(consolePanelChrome('primary'), 'overflow-hidden', className)} data-testid="overview-operating-state">
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <p className={overviewTypography.heroLabel}>Serving agents</p>
        <p className={cn('mt-1', overviewTypography.heroMetric)}>
          {kpis.productionAgents === null ? <Unavailable className="text-2xl/8" /> : kpis.productionAgents}
        </p>
        <p className={cn('mt-1', overviewTypography.heroDetail)}>
          Production or display-status production · {OVERVIEW_WINDOW_LABEL}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-5">
        {secondary.map((metric) => (
          <div key={metric.label} className="bg-surface-overlay px-4 py-3.5 sm:px-5">
            <p className={overviewTypography.secondaryLabel}>{metric.label}</p>
            <p className={cn('mt-1', overviewTypography.secondaryMetric)}>{metric.value}</p>
            <p className={cn('mt-1', overviewTypography.lineMeta)}>{metric.detail}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
