import Link from 'next/link'
import { BarBreakdown, type BarBreakdownRow } from '@/components/console/charts/bar-breakdown'
import { StatusDot } from '@/components/ui/status-dot'
import { cn } from '@/components/ui/cn'
import type { TelemetryHealthDiagnostic } from '@/lib/agent-mission-control/telemetry-health'
import type { RuntimeTelemetryEvent } from '@/lib/agent-mission-control/runtime-telemetry-store'
import { classifyRuntimeTelemetryProvenance } from '@/lib/agent-mission-control/runtime-telemetry-provenance'
import { consolePanelChrome } from '../console-variants'
import { EmptyState, ErrorState, Unavailable } from '../screen-primitives'
import { formatDeliveryStamp, overviewTypography, telemetryProvenanceLabel } from './overview-helpers'

function channelStatusLabel(status: TelemetryHealthDiagnostic['status']): React.ReactNode {
  switch (status) {
    case 'not_configured':
      return 'Not configured'
    case 'incomplete_configuration':
      return 'No agent declares it'
    case 'loop_muted':
      return <span className="text-[var(--state-danger-text)]">Muted</span>
    case 'healthy':
      return <StatusDot tone="positive">Healthy</StatusDot>
    case 'unavailable':
      return <Unavailable className="text-sm/6" />
  }
}

function provenanceRows(events: RuntimeTelemetryEvent[]): BarBreakdownRow[] {
  const counts = { internal: 0, lifecycle: 0, consumer: 0, unknown: 0 }
  for (const event of events) {
    const provenance = classifyRuntimeTelemetryProvenance(event)
    counts[provenance] += 1
  }
  return [
    { label: 'internal', count: counts.internal },
    { label: 'lifecycle', count: counts.lifecycle },
    { label: 'consumer', count: counts.consumer },
    { label: 'unknown', count: counts.unknown },
  ]
}

const FEED_LIMIT = 6

export function OverviewTelemetryPanel({
  telemetryHealth,
  reportingAgents,
  runsInFeed,
  events,
  className,
}: {
  telemetryHealth: TelemetryHealthDiagnostic
  reportingAgents: number | null
  runsInFeed: number | null
  events: RuntimeTelemetryEvent[] | null
  className?: string
}) {
  const feed = events === null ? null : events.slice(0, FEED_LIMIT)
  const consumerCount =
    events === null ? null : events.filter((e) => classifyRuntimeTelemetryProvenance(e) === 'consumer').length

  const lastReceived =
    events !== null && events.length > 0 ? formatDeliveryStamp(events[0].receivedAt) : null

  return (
    <section className={cn(consolePanelChrome('secondary'), className)} data-testid="overview-telemetry">
      <header className="border-b border-line px-4 py-3.5 sm:px-5">
        <h2 className={overviewTypography.zoneTitle}>Runtime telemetry</h2>
        <p className={cn('mt-0.5', overviewTypography.zoneDescription)}>
          Global channel — internal runs, lifecycle events and consumer traffic when reported
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
        {[
          { label: 'Channel', value: channelStatusLabel(telemetryHealth.status) },
          { label: 'Last received', value: lastReceived ?? <Unavailable className="text-sm/6" /> },
          {
            label: 'Events in feed',
            value: runsInFeed === null ? <Unavailable className="text-sm/6" /> : runsInFeed,
          },
          {
            label: 'Agents reporting',
            value: reportingAgents === null ? <Unavailable className="text-sm/6" /> : reportingAgents,
          },
        ].map((item) => (
          <div key={item.label} className="bg-surface-raised px-4 py-3">
            <dt className={overviewTypography.secondaryLabel}>{item.label}</dt>
            <dd className={cn('mt-1 text-sm/6 text-content')}>{item.value}</dd>
          </div>
        ))}
      </dl>

      {events === null ? (
        <ErrorState
          title="Telemetry events unavailable"
          description="The runtime-telemetry table could not be read this round."
          className="m-4"
        />
      ) : events.length === 0 ? (
        <EmptyState
          title="No runtime telemetry event recorded yet"
          description="Internal runner events, lifecycle promotions and consumer POSTs share this channel. The first event will appear here with its provenance."
          className="px-5 py-6"
        />
      ) : (
        <>
          <div className="border-b border-line px-2 py-2">
            <p className={cn('px-2 pb-1', overviewTypography.secondaryLabel)}>Provenance in feed</p>
            <BarBreakdown
              rows={provenanceRows(events)}
              total={Math.max(events.length, 1)}
              ariaLabel="Telemetry provenance distribution"
            />
            <p className={cn('px-4 pb-2', overviewTypography.lineMeta)}>
              {consumerCount === 0
                ? '0 consumer events measured in the current feed window.'
                : `${consumerCount} consumer event${consumerCount === 1 ? '' : 's'} in the current feed window.`}
            </p>
          </div>

          <ul className="divide-y divide-line">
            {feed?.map((event) => {
              const provenance = classifyRuntimeTelemetryProvenance(event)
              return (
                <li key={event.id} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <p className={overviewTypography.lineTitle}>
                        <Link href={`/admin/agents/${event.agentId}`} className="font-mono hover:text-accent-300">
                          {event.agentId}
                        </Link>
                      </p>
                      <dl className="grid grid-cols-1 gap-0.5 text-sm/6 sm:grid-cols-2">
                        <div>
                          <dt className={overviewTypography.lineMeta}>Provenance</dt>
                          <dd className="text-content-muted">{telemetryProvenanceLabel(provenance)}</dd>
                        </div>
                        <div>
                          <dt className={overviewTypography.lineMeta}>Project</dt>
                          <dd className="font-mono text-content-muted">{event.projectId}</dd>
                        </div>
                        <div>
                          <dt className={overviewTypography.lineMeta}>Type</dt>
                          <dd className="text-content-muted">{event.eventType ?? 'run'}</dd>
                        </div>
                        <div>
                          <dt className={overviewTypography.lineMeta}>Status</dt>
                          <dd>
                            <StatusDot tone={event.status === 'failed' ? 'negative' : event.status === 'completed' ? 'positive' : 'neutral'}>
                              {event.status}
                            </StatusDot>
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <time className={cn('shrink-0', overviewTypography.lineMeta)} dateTime={event.receivedAt}>
                      {formatDeliveryStamp(event.receivedAt)} UTC
                    </time>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
