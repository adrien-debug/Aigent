import { Badge } from '@/components/catalyst/badge'
import type { CopilotStatus } from '@/lib/agent-mission-control/types'

const statusConfig: Record<
  CopilotStatus,
  { label: string; color: 'green' | 'amber' | 'zinc'; dotClassName: string; badgeClassName?: string }
> = {
  active: {
    label: 'Active',
    color: 'green',
    dotClassName: 'bg-green-500 dark:bg-green-400',
  },
  degraded: {
    label: 'Degraded',
    color: 'amber',
    dotClassName: 'bg-amber-500 dark:bg-amber-400',
  },
  paused: {
    label: 'Paused',
    color: 'zinc',
    dotClassName: 'bg-zinc-500 dark:bg-zinc-400',
  },
  draft: {
    label: 'Draft',
    color: 'zinc',
    dotClassName: 'bg-zinc-400 dark:bg-zinc-300',
  },
  archived: {
    label: 'Archived',
    color: 'zinc',
    dotClassName: 'bg-zinc-600 dark:bg-zinc-600',
    badgeClassName: 'opacity-75',
  },
}

/**
 * Copilot lifecycle status — colored dot + always-visible text label
 * (color is never the only indicator).
 */
export function StatusBadge({ status }: { status: CopilotStatus }) {
  const config = statusConfig[status]

  return (
    <Badge color={config.color} className={config.badgeClassName}>
      <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${config.dotClassName}`} />
      {config.label}
    </Badge>
  )
}
