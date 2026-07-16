import clsx from 'clsx'

import { surfaceCardClass, surfaceCardHeaderClass } from '@/components/agent-ops/surface-card'

/**
 * Reusable skeleton block for a SurfaceCard-shaped section.
 */
function SectionSkeleton({
  className,
  headerWidth = 'w-48',
  descWidth = 'w-72',
  children,
}: {
  className?: string
  headerWidth?: string
  descWidth?: string
  children?: React.ReactNode
}) {
  return (
    <div className={clsx(surfaceCardClass, className)}>
      <div className={clsx(surfaceCardHeaderClass, 'px-6 py-4')}>
        <div className={clsx("h-5 rounded bg-zinc-950/10 dark:bg-white/10", headerWidth)} />
        <div className={clsx("mt-2 h-3.5 rounded bg-zinc-950/5 dark:bg-white/5", descWidth)} />
      </div>
      <div className="px-6 py-6">{children}</div>
    </div>
  )
}

export default function AdminDashboardLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-8 pb-12 motion-safe:animate-pulse">
      <span className="sr-only">Loading Dashboard…</span>

      {/* DashboardHeader + DashboardDataWarnings + DashboardKpiStrip (5 stats) */}
      <div className={surfaceCardClass}>
        <div className="border-b border-white/5 bg-black/20 px-6 py-6 lg:px-8">
          <div className="h-3 w-20 rounded bg-white/10" />
          <div className="mt-2 h-8 w-72 rounded-lg bg-white/10 sm:w-96" />
        </div>
        <div className="grid grid-cols-2 gap-8 px-6 py-6 sm:grid-cols-3 lg:grid-cols-5 lg:px-8">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-y-2">
              <div className="h-3 w-20 rounded bg-white/10" />
              <div className="h-9 w-16 rounded-lg bg-white/10" />
            </div>
          ))}
        </div>
      </div>

      {/* DashboardProjectList (xl:col-span-2) + ActionCenter */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <SectionSkeleton className="xl:col-span-2" headerWidth="w-40" descWidth="w-64">
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex overflow-hidden rounded-xl border border-white/5">
                <div className="w-24 shrink-0 self-stretch bg-zinc-950/10 sm:w-40 dark:bg-white/10" />
                <div className="flex-1 space-y-3 p-4">
                  <div className="h-4 w-40 rounded bg-zinc-950/10 dark:bg-white/10" />
                  <div className="h-3 w-24 rounded bg-zinc-950/5 dark:bg-white/5" />
                  <div className="h-8 rounded bg-zinc-950/5 dark:bg-white/5" />
                </div>
              </div>
            ))}
          </div>
        </SectionSkeleton>
        <SectionSkeleton headerWidth="w-28" descWidth="w-40">
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 rounded-lg bg-zinc-950/5 dark:bg-white/5" />
            ))}
          </div>
        </SectionSkeleton>
      </div>
    </div>
  )
}
