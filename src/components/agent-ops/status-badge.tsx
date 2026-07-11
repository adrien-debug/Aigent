import type { CopilotStatus } from '@/lib/agent-mission-control/types'

const statusLabels: Record<CopilotStatus, string> = {
  active: 'Active',
  degraded: 'Degraded',
  paused: 'Paused',
  draft: 'Draft',
  archived: 'Archived',
}

/**
 * Copilot lifecycle status — plain muted text label (no colored badge/dot).
 */
export function StatusBadge({ status }: { status: CopilotStatus }) {
  return <span className="text-zinc-500 dark:text-zinc-400">{statusLabels[status]}</span>
}
