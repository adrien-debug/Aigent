import { CheckIcon, ClipboardDocumentCheckIcon, ClockIcon, PlusIcon } from '@heroicons/react/20/solid'
import clsx from 'clsx'

import { EmptyState } from '@/components/agent-ops/empty-state'

/**
 * Gate history feed — application-ui feed rhythm adapted to the doctrine.
 * Monochrome accent + zinc only (never a second hue); meaning is carried by the
 * icon + label, colour is only intensity:
 * - evaluated / entered → zinc (neutral lifecycle events)
 * - approval            → accent (attention: a human decision is pending/recorded)
 * - promoted            → accent (the affirmative sign-off event)
 * The ring-8 mask simulates the card surface (dark: zinc-950) so nodes read as
 * sitting on the connector line, not floating.
 */

export type GateHistoryEventKind = 'evaluated' | 'approval' | 'entered' | 'promoted'

export interface GateHistoryEvent {
  id: string
  content: string
  target: string
  date: string
  datetime: string
  kind: GateHistoryEventKind
}

const KIND_STYLES: Record<
  GateHistoryEventKind,
  { Icon: typeof CheckIcon; iconBackground: string; iconColor: string }
> = {
  evaluated: { Icon: ClipboardDocumentCheckIcon, iconBackground: 'bg-zinc-600', iconColor: 'text-white' },
  approval: { Icon: ClockIcon, iconBackground: 'bg-accent-500', iconColor: 'text-accent-950' },
  entered: { Icon: PlusIcon, iconBackground: 'bg-zinc-600', iconColor: 'text-white' },
  promoted: { Icon: CheckIcon, iconBackground: 'bg-accent-500', iconColor: 'text-white' },
}

export function GateHistoryFeed({ events }: { events: GateHistoryEvent[] }) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={ClipboardDocumentCheckIcon}
        title="No gate activity yet"
        description="This candidate hasn't been evaluated against the promotion gate. History appears here once a gate run records its first event."
      />
    )
  }

  return (
    <div className="flow-root">
      <ul role="list" className="-mb-8">
        {events.map((event, eventIdx) => {
          const { Icon, iconBackground, iconColor } = KIND_STYLES[event.kind]
          return (
            <li key={event.id}>
              <div className="relative pb-8">
                {eventIdx !== events.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-zinc-950/10 dark:bg-white/10"
                  />
                ) : null}
                <div className="relative flex space-x-3">
                  <div>
                    <span
                      className={clsx(
                        iconBackground,
                        'flex size-8 items-center justify-center rounded-full ring-8 ring-white dark:ring-zinc-950'
                      )}
                    >
                      <Icon aria-hidden="true" className={clsx('size-5', iconColor)} />
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-1 justify-between space-x-4 pt-1.5">
                    <div>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        {event.content}{' '}
                        <span className="font-medium text-zinc-950 dark:text-white">{event.target}</span>
                      </p>
                    </div>
                    <div className="text-right text-sm whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                      <time dateTime={event.datetime}>{event.date}</time>
                    </div>
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
