import { EmptyState } from '@/components/agent-ops/empty-state'
import { RunStatusText } from '@/components/agent-ops/run-detail-panel'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { Link } from '@/components/ui/link'
import { getRecentRuns } from '@/lib/agent-mission-control/data'
import { formatDurationMs, formatRelativeCompact, formatTimestamp, formatUsd } from '@/lib/agent-mission-control/format'

export async function DashboardLiveRuns() {
  const runs = await getRecentRuns(8)
  const nowIso = new Date().toISOString()

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Live Runs"
        density="compact"
        meta={<span className="font-mono text-xs tabular-nums text-zinc-500">{runs.length} recent</span>}
      />
      {runs.length > 0 ? (
        <ul className="divide-y divide-zinc-950/5 border-t border-zinc-950/5">
          {runs.map((run) => (
            // Two levels on mobile (identity, then the metric strip), two columns from
            // sm up. The metric column is `auto`: it is sized by its content, so no
            // duration and no amount can ever be silently truncated.
            <li
              key={run.id}
              className="grid gap-1 px-4 py-2.5 hover:bg-white/2.5 sm:min-h-14 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/admin/agents/${run.copilotId}/runs?run=${run.id}`}
                    title={run.id}
                    className="block truncate text-sm font-medium text-zinc-900 dark:text-white hover:underline"
                  >
                    {run.userLabel}
                  </Link>
                  <RunStatusText status={run.status} />
                </div>
              </div>
              {/* `min-w-*` (never `w-*`) keeps the three metrics aligned column-wise
                  while letting an unusually long value push instead of clip.
                  Labels are sr-only text, not `title=`: a tooltip is mouse-only. */}
              <div className="flex items-baseline justify-end gap-4 font-mono text-xs tabular-nums">
                <span className="min-w-14 whitespace-nowrap text-right text-zinc-500">
                  <span className="sr-only">Duration: </span>
                  {formatDurationMs(run.latencyMs)}
                </span>
                <span className="min-w-16 whitespace-nowrap text-right text-zinc-500">
                  <span className="sr-only">Cost: </span>
                  {run.costUsd === null ? '—' : formatUsd(run.costUsd)}
                </span>
                <span
                  className="min-w-10 whitespace-nowrap text-right text-zinc-400"
                  title={formatTimestamp(run.startedAt)}
                >
                  <span className="sr-only">Started: </span>
                  {formatRelativeCompact(run.startedAt, nowIso)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No recent runs" className="py-8" />
      )}
    </SurfaceCard>
  )
}
