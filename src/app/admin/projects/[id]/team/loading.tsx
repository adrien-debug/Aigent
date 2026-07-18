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
    <div aria-busy="true" aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-4 motion-safe:animate-pulse">
      <span className="sr-only">Loading the project team graph…</span>

      {/* Identity row — one line, matching page.tsx */}
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-lg bg-white/10" />
        <div className="h-5 w-56 rounded-lg bg-white/10" />
        <div className="h-3.5 w-24 rounded bg-white/5" />
      </div>

      {/* Tab strip */}
      <div className="flex gap-6 border-b border-white/10 pb-3">
        <div className="h-4 w-20 rounded bg-white/10" />
        <div className="h-4 w-24 rounded bg-white/5" />
        <div className="h-4 w-20 rounded bg-white/5" />
      </div>

      {/* Summary strip — one compact inline row, not a KPI band */}
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-4 w-24 rounded bg-white/10" />
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
        {/* Mirrors the live canvas: flex-derived height, never a calc() guess
            about the chrome above it — the two must not drift apart. */}
        <div className="min-h-96 w-full flex-1 bg-black/20" />
      </div>
    </div>
  )
}
