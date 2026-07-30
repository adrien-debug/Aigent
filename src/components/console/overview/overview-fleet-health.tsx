import type { DashboardKpis } from '@/lib/agent-mission-control/dashboard-overview'
import { BarBreakdown, type BarBreakdownRow } from '@/components/console/charts/bar-breakdown'
import { cn } from '@/components/ui/cn'
import { consoleTypography } from '../console-variants'
import { Section, Unavailable } from '../screen-primitives'

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
    <Section
      title="Fleet health"
      description={executableLabel ?? 'Executable share and blockers at a glance'}
      presentation="editorial"
      className={cn('h-full rounded-2xl', className)}
    >
      {rows.length === 0 ? (
        <p className={cn('px-4 py-6', consoleTypography.bodySm, 'text-content-muted')}>
          {kpis.productionAgents === null && kpis.executableNow === null ? (
            <Unavailable />
          ) : (
            'No blocker or attention signal is active in the current reads.'
          )}
        </p>
      ) : (
        <BarBreakdown rows={rows} total={scaleBase} ariaLabel="Fleet health breakdown" />
      )}
    </Section>
  )
}
