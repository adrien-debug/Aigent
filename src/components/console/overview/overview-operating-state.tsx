import { cn } from '@/components/ui/cn'
import type { DashboardKpis } from '@/lib/agent-mission-control/dashboard-overview'
import { formatUsd } from '@/lib/agent-mission-control/format'
import { Unavailable } from '../screen-primitives'
import { OVERVIEW_WINDOW_LABEL, RUNS_UNREAD_DETAIL } from './overview-helpers'

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
    <section
      className={cn(
        'grid overflow-hidden rounded-[28px] border border-line-strong bg-surface-overlay shadow-(--shadow-card-lg) lg:grid-cols-12',
        className
      )}
      data-testid="overview-operating-state"
    >
      <div className="relative overflow-hidden border-b border-line px-6 py-7 sm:px-8 sm:py-9 lg:col-span-4 lg:border-r lg:border-b-0">
        <div className="absolute -right-12 -bottom-16 size-44 rounded-full bg-accent-500/20 blur-3xl" aria-hidden="true" />
        <p className="relative text-[11px]/4 font-semibold uppercase tracking-[0.16em] text-accent-800">
          Serving agents
        </p>
        <p className="relative mt-3 text-[64px]/16 font-light tabular-nums tracking-[-0.06em] text-content">
          {kpis.productionAgents === null ? <Unavailable className="text-xl/8" /> : kpis.productionAgents}
        </p>
        <p className="relative mt-4 max-w-xs text-sm/6 text-content-muted">
          Agents currently presented as production-serving.
        </p>
        <p className="relative mt-1 text-[11px]/4 text-content-subtle">{OVERVIEW_WINDOW_LABEL}</p>
      </div>
      <dl className="grid grid-cols-2 lg:col-span-8 lg:grid-cols-5">
        {secondary.map((metric, index) => (
          <div
            key={metric.label}
            className={cn(
              'min-w-0 px-4 py-5 sm:px-5 lg:flex lg:flex-col lg:justify-end lg:py-7',
              index % 2 === 1 && 'border-l border-line',
              index > 1 && 'border-t border-line',
              index > 0 && 'lg:border-l',
              index === secondary.length - 1 && 'col-span-2 lg:col-span-1',
              'lg:border-t-0'
            )}
          >
            <dt className="text-[10px]/4 font-semibold uppercase tracking-[0.14em] text-content-subtle">
              {metric.label}
            </dt>
            <dd className="mt-2 text-[26px]/8 font-light tabular-nums tracking-tight text-content">{metric.value}</dd>
            <p className="mt-2 text-[11px]/4 text-content-subtle">{metric.detail}</p>
          </div>
        ))}
      </dl>
    </section>
  )
}
