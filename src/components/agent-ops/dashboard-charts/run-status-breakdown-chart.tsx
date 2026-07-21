import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { EmptyState } from '@/components/agent-ops/empty-state'
import type { AgentRun, AgentRunStatus } from '@/lib/agent-mission-control/types'

const STATUS_ORDER: AgentRunStatus[] = ['completed', 'failed', 'blocked', 'needs-confirmation', 'running']

const STATUS_LABEL: Record<AgentRunStatus, string> = {
  completed: 'Completed',
  failed: 'Failed',
  blocked: 'Blocked',
  'needs-confirmation': 'Needs confirmation',
  running: 'Running',
}

// Completed = the accent success token; every other status is a zinc shade so
// the chart never turns into a rainbow — only "good" gets the accent.
const STATUS_BAR_CLASS: Record<AgentRunStatus, string> = {
  completed: 'bg-[var(--chart-success)]',
  failed: 'bg-zinc-400',
  blocked: 'bg-zinc-500',
  'needs-confirmation': 'bg-zinc-600',
  running: 'bg-zinc-300',
}

/**
 * RunStatusBreakdownChart — horizontal bars of run counts per status over the
 * same window as the other 24h charts, computed from the SAME `runs` array
 * (no separate fetch, no truncation beyond what the caller already sliced).
 * Only statuses that actually occur in the data render a row.
 */
export function RunStatusBreakdownChart({ runs }: { runs: AgentRun[] }) {
  const counts = new Map<AgentRunStatus, number>()
  for (const run of runs) {
    counts.set(run.status, (counts.get(run.status) ?? 0) + 1)
  }

  const rows = STATUS_ORDER
    .map((status) => ({ status, count: counts.get(status) ?? 0 }))
    .filter((row) => row.count > 0)

  const total = rows.reduce((s, r) => s + r.count, 0)

  if (total === 0) {
    return (
      <SurfaceCard>
        <SurfaceCardHeader title="Run status breakdown" className="px-4 pt-3 pb-2" />
        <EmptyState title="No runs to break down" description="No runs were found in the current window." />
      </SurfaceCard>
    )
  }

  const maxCount = Math.max(...rows.map((r) => r.count))

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Run status breakdown"
        className="px-4 pt-3 pb-2"
        meta={<span className="font-mono text-xs text-zinc-400 tabular-nums">{total} total</span>}
      />
      <div className="flex flex-col gap-3 px-4 pt-1 pb-4">
        {rows.map((row) => (
          <div key={row.status} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-xs text-zinc-400">{STATUS_LABEL[row.status]}</span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-surface-sunken">
              <div
                className={`h-full rounded-full ${STATUS_BAR_CLASS[row.status]}`}
                style={{ width: `${Math.max((row.count / maxCount) * 100, 2)}%` }}
                title={`${STATUS_LABEL[row.status]}: ${row.count}`}
              />
            </div>
            <span className="w-10 shrink-0 text-right font-mono text-xs text-zinc-300 tabular-nums">
              {row.count}
            </span>
          </div>
        ))}
      </div>
    </SurfaceCard>
  )
}
