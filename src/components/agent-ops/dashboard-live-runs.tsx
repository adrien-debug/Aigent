import { EmptyState } from '@/components/agent-ops/empty-state'
import { RunStatusText } from '@/components/agent-ops/run-detail-panel'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { TouchTarget } from '@/components/ui/button'
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
        meta={<span className="font-mono text-xs tabular-nums text-zinc-400">{runs.length} recent</span>}
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
                  {/* 20px tall was the whole tap target for the row's only link. `TouchTarget`
                      (the kit's own, used by `Button`/`BadgeButton`) lifts it to 44px on a
                      COARSE pointer and stays invisible on a fine one, so desktop is untouched.
                      One detail is load-bearing: `truncate` moved OFF the anchor onto an inner
                      span. `truncate` implies `overflow:hidden`, which CLIPS the absolutely
                      positioned pad back to the 20px line box — the fix would have measured as
                      a no-op. The anchor now carries only `relative`, the pad's anchor.
                      No `z-index` here, and that is measured, not assumed: the pad reaches 12px
                      past the anchor and overlaps the status line below, but a positioned
                      element already paints above a later sibling's in-flow content.
                      `elementFromPoint` at the top edge, the middle and the bottom edge of the
                      44px box returns this link with AND without a `z-10` — so the class would
                      have been decoration and is not written. */}
                  <Link
                    href={`/admin/agents/${run.copilotId}/runs?run=${run.id}`}
                    title={run.id}
                    // Focus ring added: this link declared none, so keyboard focus landed on
                    // the UA fallback — measured `1px auto rgb(0, 95, 204)`, a browser blue
                    // that is in no token of this design system. Same three classes as
                    // `project-header.tsx`, measured `2px solid rgb(167, 251, 144)`.
                    className="relative block rounded-sm text-sm font-medium text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 dark:text-white hover:underline"
                  >
                    <TouchTarget>
                      <span className="block truncate">{run.userLabel}</span>
                    </TouchTarget>
                  </Link>
                  <RunStatusText status={run.status} />
                </div>
              </div>
              {/* `min-w-*` (never `w-*`) keeps the three metrics aligned column-wise
                  while letting an unusually long value push instead of clip.
                  Labels are sr-only text, not `title=`: a tooltip is mouse-only. */}
              {/* One tone for the three metrics. Duration and cost were zinc-500
                  while the relative time beside them was zinc-400 — three peers
                  on one baseline, two ranks of ink, decided by nothing. zinc-400
                  is the survivor: zinc-500 measures 3.59:1 on this plane, below
                  the 4.5 AA floor (`check:contrast`), everywhere it appears. */}
              <div className="flex items-baseline justify-end gap-4 font-mono text-xs tabular-nums">
                <span className="min-w-14 whitespace-nowrap text-right text-zinc-400">
                  <span className="sr-only">Duration: </span>
                  {formatDurationMs(run.latencyMs)}
                </span>
                <span className="min-w-16 whitespace-nowrap text-right text-zinc-400">
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
        /* `padding="compact"` replaces a `className="py-8"` that never applied:
           probed in the browser, `px-6 py-12 py-8` computes to 48px — the card
           was 32px taller than this file has been claiming since it was
           written, and taller than the peer card it shares its grid row with. */
        <EmptyState title="No recent runs" padding="compact" className="flex-1" />
      )}
    </SurfaceCard>
  )
}
