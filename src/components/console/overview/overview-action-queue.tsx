import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/ui/status-dot'
import { cn } from '@/components/ui/cn'
import type { ActionItem } from '@/lib/agent-mission-control/dashboard-overview'
import { consolePanelChrome } from '../console-variants'
import { EmptyState } from '../screen-primitives'
import {
  actionKindLabel,
  actionStatusTone,
  overviewTypography,
  resolveConsoleHref,
  sortActionItems,
} from './overview-helpers'

function ActionQueueRow({ item, featured }: { item: ActionItem; featured?: boolean }) {
  const href = resolveConsoleHref(item.href)

  return (
    <div
      className={cn(
        'border-b border-line px-4 py-3.5 last:border-b-0 sm:px-5',
        featured && 'bg-surface-selected/40'
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(overviewTypography.kindBadge, 'text-accent-600 dark:text-accent-300')}>
              {actionKindLabel(item.kind)}
            </span>
            <StatusDot tone={actionStatusTone(item.status)} className="max-w-none">
              {item.status}
            </StatusDot>
          </div>
          <p className={overviewTypography.lineTitle}>{item.title}</p>
          <p className={overviewTypography.lineBody}>{item.meta}</p>
          {href === null ? (
            <p className={cn(overviewTypography.lineMeta, 'font-mono break-all')}>{item.href}</p>
          ) : null}
        </div>
        {href !== null ? (
          featured ? (
            <Button href={href} color="accent" className="shrink-0">
              {item.buttonLabel}
            </Button>
          ) : (
            <Button href={href} outline className="shrink-0">
              {item.buttonLabel}
            </Button>
          )
        ) : null}
      </div>
    </div>
  )
}

export function OverviewActionQueue({
  items,
  readFailed,
  className,
}: {
  items: ActionItem[]
  /** True when architect/delivery/sandbox scans failed — queue may be incomplete. */
  readFailed: boolean
  className?: string
}) {
  const ordered = sortActionItems(items)

  return (
    <section className={cn(consolePanelChrome('primary'), 'flex min-h-0 flex-col', className)} data-testid="overview-action-queue">
      <header className="border-b border-line px-4 py-3.5 sm:px-5">
        <h2 className={overviewTypography.zoneTitle}>Action queue</h2>
        <p className={cn('mt-0.5', overviewTypography.zoneDescription)}>
          Highest-priority operator decisions — approvals, blockers and ready states
        </p>
      </header>

      {readFailed ? (
        <div className="border-b border-line px-4 py-2 sm:px-5">
          <p className={cn(overviewTypography.lineMeta, 'text-[var(--state-danger-text)]')}>
            One or more queue sources could not be read — items below may be incomplete.
          </p>
        </div>
      ) : null}

      <div className="max-h-[28rem] min-h-0 overflow-y-auto">
        {ordered.length === 0 ? (
          <EmptyState
            title="No operator action required"
            description="The queue watches architect approvals, sandbox failures, release-gate blockers, open PRs and mission blockers. When one appears, it surfaces here first."
            className="px-5 py-8"
          />
        ) : (
          ordered.map((item, index) => <ActionQueueRow key={item.id} item={item} featured={index === 0} />)
        )}
      </div>
    </section>
  )
}
