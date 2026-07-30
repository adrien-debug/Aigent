import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/ui/status-dot'
import { cn } from '@/components/ui/cn'
import type { RecentDelivery } from '@/lib/agent-mission-control/dashboard-overview'
import { EmptyState, ErrorState, PanelRow, Section } from '../screen-primitives'
import { actionStatusTone, formatDeliveryStamp } from './overview-helpers'

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
    <div className={className} data-testid="overview-deliveries">
      <Section
        title="Recent deliveries"
        description="Latest push per agent — compact feed"
        presentation="editorial"
        className={cn('h-full rounded-2xl', deliveries === null && 'border-(--state-danger-solid-line)')}
      >
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
            <li key={delivery.event.id}>
              <PanelRow
                title={
                    <Link href={`/admin/agents/${delivery.copilotId}`} className="font-mono hover:text-accent-700">
                      {delivery.copilotId}
                    </Link>
                }
                subtitle={
                  <span className="font-mono">
                    {delivery.event.targetRepo}
                    {delivery.event.commitSha ? ` · ${delivery.event.commitSha.slice(0, 7)}` : ''}
                  </span>
                }
                values={[
                  {
                    label: 'delivered',
                    value: `${formatDeliveryStamp(delivery.event.createdAt)} UTC`,
                  },
                ]}
                trailing={
                  <div className="flex items-center gap-2">
                  <StatusDot tone={actionStatusTone(delivery.event.status)}>{delivery.event.status}</StatusDot>
                  <Button href={`/admin/agents/${delivery.copilotId}`} outline>
                    Open
                  </Button>
                  </div>
                }
              />
            </li>
          ))}
        </ul>
      )}
      </Section>
    </div>
  )
}
