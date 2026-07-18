import clsx from 'clsx'

import { surfaceCardClass } from '@/components/agent-ops/surface-card'

/**
 * Skeleton for the team graph. Blocks mirror the real layout 1:1 (identity row,
 * tab strip, KPI band, toolbar, canvas slab) so the page does not jump when the
 * data lands. No placeholder nodes, no temporary graph — an invented topology
 * flashed for 300ms is still an invented topology.
 */
export default function ProjectTeamLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-6 motion-safe:animate-pulse">
      <span className="sr-only">Loading the project team graph…</span>

      {/* Identity row */}
      <div className="flex items-center gap-4">
        <div className="size-12 rounded-lg bg-white/10" />
        <div>
          <div className="h-7 w-56 rounded-lg bg-white/10" />
          <div className="mt-2 h-3.5 w-40 rounded bg-white/5" />
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex gap-6 border-b border-white/10 pb-3">
        <div className="h-4 w-20 rounded bg-white/10" />
        <div className="h-4 w-24 rounded bg-white/5" />
        <div className="h-4 w-20 rounded bg-white/5" />
      </div>

      {/* KPI band — 6 naked stats */}
      <div className="grid grid-cols-2 gap-x-12 gap-y-6 border-b border-white/5 py-4 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="h-3 w-20 rounded bg-white/10" />
            <div className="h-7 w-16 rounded-lg bg-white/10" />
          </div>
        ))}
      </div>

      {/* Toolbar + canvas slab */}
      <div className={clsx(surfaceCardClass, 'flex min-h-0 flex-1 flex-col')}>
        <div className="flex flex-wrap items-center gap-3 border-b border-white/5 px-4 py-3">
          <div className="h-9 w-64 rounded-lg bg-white/5" />
          <div className="h-9 w-40 rounded-lg bg-white/5" />
          <div className="h-9 w-40 rounded-lg bg-white/5" />
          <div className="ml-auto h-9 w-56 rounded-lg bg-white/5" />
        </div>
        <div className="h-[60vh] min-h-96 w-full bg-black/20 lg:h-[calc(100svh-26rem)]" />
      </div>
    </div>
  )
}
