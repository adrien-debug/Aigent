import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/ui/status-dot'
import { cn } from '@/components/ui/cn'
import type { ActionItem } from '@/lib/agent-mission-control/dashboard-overview'
import { consoleTypography } from '../console-variants'
import { EmptyState, PanelRow, Section } from '../screen-primitives'
import {
  actionKindLabel,
  actionStatusTone,
  resolveConsoleHref,
  sortActionItems,
} from './overview-helpers'

function ActionQueueRow({ item, featured }: { item: ActionItem; featured?: boolean }) {
  const href = resolveConsoleHref(item.href)

  return (
    <PanelRow
      selected={featured}
      leading={
        <div className="flex w-24 flex-col items-start gap-1">
          <span className={cn(consoleTypography.eyebrow, 'text-accent-800')}>{actionKindLabel(item.kind)}</span>
          <StatusDot tone={actionStatusTone(item.status)} className="max-w-24">
            {item.status}
          </StatusDot>
        </div>
      }
      title={item.title}
      subtitle={
        <span>
          {item.meta}
          {href === null ? <span className="ml-2 font-mono">{item.href}</span> : null}
        </span>
      }
      trailing={
        href === null ? null : featured ? (
          <Button href={href} color="accent">
            {item.buttonLabel}
          </Button>
        ) : (
          <Button href={href} outline>
            {item.buttonLabel}
          </Button>
        )
      }
    />
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
    <div className={className} data-testid="overview-action-queue">
      <Section
        title="Action queue"
        description="Highest-priority operator decisions — approvals, blockers and ready states"
        priority="primary"
        presentation="editorial"
        bodyClassName="max-h-80 overflow-y-auto"
        className="h-full rounded-2xl"
      >
        {readFailed ? (
          <p className={cn('border-b border-line px-4 py-2 text-(--state-danger-text)', consoleTypography.caption)}>
            One or more queue sources could not be read — items below may be incomplete.
          </p>
        ) : null}
        {ordered.length === 0 ? (
          <EmptyState
            title="No operator action required"
            description="The queue watches architect approvals, sandbox failures, release-gate blockers, open PRs and mission blockers. When one appears, it surfaces here first."
            className="px-5 py-8"
          />
        ) : (
          ordered.map((item, index) => <ActionQueueRow key={item.id} item={item} featured={index === 0} />)
        )}
      </Section>
    </div>
  )
}
