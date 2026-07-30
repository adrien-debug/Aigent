import type { DashboardKpis } from '@/lib/agent-mission-control/dashboard-overview'
import { BarBreakdown, type BarBreakdownRow } from '@/components/console/charts/bar-breakdown'
import { cn } from '@/components/ui/cn'
import { consolePanelChrome } from '../console-variants'
import { Unavailable } from '../screen-primitives'
import { overviewTypography } from './overview-helpers'

export function OverviewFleetHealth({
  kpis,
  approvalsPending,
  className,
}: {
  kpis: DashboardKpis
  approvalsPending: number | null
  className?: string
}) {
  const rows: BarBreakdownRow[] = []

  if (kpis.productionAgents !== null) {
    rows.push({ label: 'Serving', count: kpis.productionAgents })
  }
  if (kpis.executableNow !== null) {
    rows.push({ label: 'Executable', count: kpis.executableNow })
  }
  if (kpis.needsAction > 0) {
    rows.push({ label: 'Needs attention', count: kpis.needsAction })
  }
  if (kpis.blockedDeliveries !== null && kpis.blockedDeliveries > 0) {
    rows.push({ label: 'Blocked delivery', count: kpis.blockedDeliveries, danger: true })
  }
  if (approvalsPending !== null && approvalsPending > 0) {
    rows.push({ label: 'Approvals pending', count: approvalsPending })
  }

  const scaleBase = Math.max(
    kpis.executableTotal ?? 0,
    kpis.productionAgents ?? 0,
    rows.reduce((max, row) => Math.max(max, row.count), 0),
    1
  )

  const executableLabel =
    kpis.executableNow !== null && kpis.executableTotal !== null
      ? `${kpis.executableNow} / ${kpis.executableTotal} executable`
      : null

  return (
    <section className={cn(consolePanelChrome('secondary'), className)}>
      <header className="border-b border-line px-4 py-3.5 sm:px-5">
        <h2 className={overviewTypography.zoneTitle}>Fleet health</h2>
        <p className={cn('mt-0.5', overviewTypography.zoneDescription)}>
          {executableLabel ?? 'Executable share and blockers at a glance'}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className={cn('px-5 py-6', overviewTypography.zoneDescription)}>
          {kpis.productionAgents === null && kpis.executableNow === null ? (
            <Unavailable />
          ) : (
            'No blocker or attention signal is active in the current reads.'
          )}
        </p>
      ) : (
        <BarBreakdown rows={rows} total={scaleBase} ariaLabel="Fleet health breakdown" />
      )}
    </section>
  )
}
