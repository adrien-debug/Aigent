import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/ui/status-dot'
import { cn } from '@/components/ui/cn'
import type { RecentDelivery } from '@/lib/agent-mission-control/dashboard-overview'
import { consolePanelChrome } from '../console-variants'
import { EmptyState, ErrorState } from '../screen-primitives'
import { actionStatusTone, formatDeliveryStamp, overviewTypography } from './overview-helpers'

const DELIVERY_LIMIT = 5

export function OverviewDeliveries({
  deliveries,
  className,
}: {
  deliveries: RecentDelivery[] | null
  className?: string
}) {
  const rows = deliveries === null ? null : deliveries.slice(0, DELIVERY_LIMIT)

  return (
    <section
      className={cn(
        consolePanelChrome('secondary'),
        deliveries === null && 'border-[var(--state-danger-solid-line)]',
        className
      )}
      data-testid="overview-deliveries"
    >
      <header className="border-b border-line px-4 py-3 sm:px-5">
        <h2 className={overviewTypography.zoneTitle}>Recent deliveries</h2>
        <p className={cn('mt-0.5', overviewTypography.zoneDescription)}>
          Latest push per agent — compact feed
        </p>
      </header>

      {deliveries === null ? (
        <ErrorState
          title="Delivery events unavailable"
          description="The delivery-event table could not be read. This is not an empty history."
          className="m-3"
        />
      ) : rows?.length === 0 ? (
        <EmptyState
          title="No delivery recorded yet"
          description="A successful agent push to a target repository will appear here with repo, status and timestamp."
          className="px-4 py-5"
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows?.map((delivery) => (
            <li key={delivery.event.id} className="px-4 py-2.5 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className={overviewTypography.lineTitle}>
                    <Link href={`/admin/agents/${delivery.copilotId}`} className="font-mono hover:text-accent-300">
                      {delivery.copilotId}
                    </Link>
                  </p>
                  <p className={cn('mt-0.5 font-mono', overviewTypography.lineMeta)}>{delivery.event.targetRepo}</p>
                  <p className={cn('mt-0.5', overviewTypography.lineMeta)}>
                    {formatDeliveryStamp(delivery.event.createdAt)} UTC
                    {delivery.event.commitSha ? ` · ${delivery.event.commitSha.slice(0, 7)}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusDot tone={actionStatusTone(delivery.event.status)}>{delivery.event.status}</StatusDot>
                  <Button href={`/admin/agents/${delivery.copilotId}`} outline className="!px-2.5 !py-1 text-xs/5">
                    Open
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
