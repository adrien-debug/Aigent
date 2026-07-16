import clsx from 'clsx'

import { surfaceCardClass, surfaceCardHeaderClass } from '@/components/agent-ops/surface-card'

export default function PerformanceLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-8 pb-12 motion-safe:animate-pulse">
      <span className="sr-only">Loading Performance…</span>

      {/* Header (+ live indicator) + KPI band (5 stats with micro-viz) */}
      <div className={surfaceCardClass}>
        <div className={clsx(surfaceCardHeaderClass, 'px-6 py-6 lg:px-8')}>
          <div>
            <div className="h-3 w-24 rounded bg-white/10" />
            <div className="mt-2 h-8 w-64 rounded-lg bg-white/10" />
            <div className="mt-3 h-3 w-80 max-w-full rounded bg-white/5" />
          </div>
          <div className="h-3 w-28 shrink-0 rounded bg-white/10" />
        </div>
        <div className="grid grid-cols-2 gap-8 px-6 py-6 sm:grid-cols-3 lg:grid-cols-5 lg:px-8">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-y-2">
              <div className="h-3 w-20 rounded bg-white/10" />
              <div className="h-9 w-16 rounded-lg bg-white/10" />
              <div className="h-2 w-24 rounded-full bg-white/5" />
            </div>
          ))}
        </div>
      </div>

      {/* Activity chart — header, plot area, hour rail, legend */}
      <div className={surfaceCardClass}>
        <div className={clsx(surfaceCardHeaderClass, 'p-4')}>
          <div className="h-5 w-44 rounded bg-white/10" />
          <div className="h-3 w-24 rounded bg-white/5" />
        </div>
        <div className="px-6 py-6">
          <div className="flex h-40 items-end gap-2">
            {Array.from({ length: 24 }).map((_, i) => (
              <div
                key={i}
                className="w-full rounded-t bg-white/5"
                style={{ height: `${((i * 7) % 11) * 8 + 12}%` }}
              />
            ))}
          </div>
          <div className="mt-2 h-3 w-full rounded bg-white/5" />
          <div className="mt-4 h-3 w-56 rounded bg-white/5" />
        </div>
      </div>

      {/* Agent leaderboard + recent runs tables */}
      {Array.from({ length: 2 }).map((_, s) => (
        <div key={s} className={surfaceCardClass}>
          <div className={clsx(surfaceCardHeaderClass, 'p-4')}>
            <div className="h-5 w-44 rounded bg-white/10" />
          </div>
          <div className="space-y-3 px-6 py-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-white/5" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
