import { ExclamationTriangleIcon } from '@heroicons/react/16/solid'

import { Badge } from '@/components/catalyst/badge'
import type { CopilotStatus } from '@/lib/agent-mission-control/types'

const statusConfig: Record<
  CopilotStatus,
  { label: string; color: 'accent' | 'accentStrong' | 'zinc'; dotClassName: string; badgeClassName?: string; warn?: boolean }
> = {
  active: {
    label: 'Active',
    color: 'accent',
    dotClassName: 'bg-accent-500 dark:bg-accent-400',
  },
  degraded: {
    label: 'Degraded',
    color: 'accentStrong',
    dotClassName: 'bg-accent-500 dark:bg-accent-300',
    warn: true,
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
      {config.warn ? (
        <ExclamationTriangleIcon aria-hidden="true" className="-ml-0.5 size-3.5 shrink-0" />
      ) : (
        <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${config.dotClassName}`} />
      )}
      {config.label}
    </Badge>
  )
}
