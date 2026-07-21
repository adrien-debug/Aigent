import { EmptyState } from '@/components/agent-ops/empty-state'
import { RunStatusText } from '@/components/agent-ops/run-detail-panel'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { Link } from '@/components/catalyst/link'
import { getRecentRuns } from '@/lib/agent-mission-control/data'
import { formatDurationMs, formatRelative, formatTimestamp, formatUsd } from '@/lib/agent-mission-control/format'

export async function DashboardLiveRuns() {
  const runs = await getRecentRuns(8)
  const nowIso = new Date().toISOString()

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Live Runs"
        className="px-4 pt-3 pb-2"
        meta={<span className="font-mono text-xs tabular-nums text-zinc-500">{runs.length} recent</span>}
      />
      {runs.length > 0 ? (
        <ul className="divide-y divide-zinc-950/5 pb-2">
          {runs.map((run) => (
            <li key={run.id} className="px-4 py-2.5 hover:bg-[var(--color-surface-focus)]">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className={`size-1.5 shrink-0 rounded-full ${
                    run.status === 'completed'
                      ? 'bg-accent-600'
                      : run.status === 'failed'
                        ? 'bg-accent-700'
                        : 'bg-zinc-400'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/agents/${run.copilotId}/runs?run=${run.id}`}
                    title={run.id}
                    className="block truncate text-sm font-medium text-zinc-900 hover:underline"
                  >
                    {run.userLabel}
                  </Link>
                  <RunStatusText status={run.status} />
                </div>
                <div className="shrink-0 text-right font-mono text-[10px] tabular-nums">
                  <div className="text-zinc-500">
                    {formatDurationMs(run.latencyMs)} · {run.costUsd === null ? '—' : formatUsd(run.costUsd)}
                  </div>
                  <div className="text-zinc-400" title={formatTimestamp(run.startedAt)}>
                    {formatRelative(run.startedAt, nowIso)}
                  </div>
                </div>
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
