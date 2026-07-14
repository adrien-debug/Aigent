import clsx from 'clsx'

import { surfaceCardClass, surfaceCardHeaderClass } from '@/components/agent-ops/surface-card'

/**
 * Reusable skeleton block for the AgentSectionCard.
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
    <div aria-busy="true" aria-live="polite" className="space-y-8 motion-safe:animate-pulse">
      <span className="sr-only">Loading Dashboard…</span>
      
      {/* AgentPageHeader */}
      <div className="mt-2 border-b border-zinc-950/5 pb-5 dark:border-white/5">
        <div className="h-8 w-40 rounded-lg bg-zinc-950/10 dark:bg-white/10" />
        <div className="mt-2 h-4 w-72 rounded-md bg-zinc-950/5 dark:bg-white/5" />
      </div>

      {/* AgentKpiBand — 4 stats */}
      <div className="grid grid-cols-2 gap-8 border-b border-white/5 py-6 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-y-2">
            <div className="h-3 w-16 rounded bg-white/10" />
            <div className="h-9 w-24 rounded-lg bg-white/10" />
          </div>
        ))}
      </div>

      {/* ProjectsCard */}
      <SectionSkeleton headerWidth="w-24" descWidth="w-64">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={clsx(surfaceCardClass, 'flex h-full flex-col')}>
              <div className="relative h-28 bg-zinc-950/5 dark:bg-white/5" />
              <div className="relative z-10 -mt-8 ml-6 size-14 rounded bg-zinc-200 ring-2 ring-white dark:bg-zinc-800 dark:ring-zinc-950" />
              <div className="flex flex-1 flex-col px-6 pt-3 pb-6">
                <div className="h-5 w-32 rounded bg-zinc-950/10 dark:bg-white/10" />
                <div className="mt-2 h-3.5 w-24 rounded bg-zinc-950/5 dark:bg-white/5" />
                <div className="mt-4 space-y-2">
                  <div className="h-3.5 w-full rounded bg-zinc-950/5 dark:bg-white/5" />
                  <div className="h-3.5 w-4/5 rounded bg-zinc-950/5 dark:bg-white/5" />
                </div>
                <div className="mt-auto grid grid-cols-3 gap-4 border-t border-zinc-950/5 pt-4 dark:border-white/5">
                  <div className="h-8 rounded bg-zinc-950/5 dark:bg-white/5" />
                  <div className="h-8 rounded bg-zinc-950/5 dark:bg-white/5" />
                  <div className="h-8 rounded bg-zinc-950/5 dark:bg-white/5" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </SectionSkeleton>

      {/* FleetCard & AttentionCard */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionSkeleton headerWidth="w-16" descWidth="w-48">
          <div className="space-y-8">
            <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i}>
                  <div className="h-3 w-16 rounded bg-zinc-950/10 dark:bg-white/10" />
                  <div className="mt-2 h-7 w-12 rounded bg-zinc-950/10 dark:bg-white/10" />
                </div>
              ))}
            </div>
            <div className="border-t border-zinc-950/5 pt-6 dark:border-white/5">
              <div className="h-3 w-32 rounded bg-zinc-950/10 dark:bg-white/10" />
              <div className="mt-4 space-y-4">
                <div className="h-4 w-full rounded bg-zinc-950/5 dark:bg-white/5" />
                <div className="h-4 w-3/4 rounded bg-zinc-950/5 dark:bg-white/5" />
              </div>
            </div>
          </div>
        </SectionSkeleton>
        <SectionSkeleton headerWidth="w-32" descWidth="w-56">
          <div className="space-y-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 rounded bg-zinc-950/10 dark:bg-white/10" />
                  <div className="h-3 w-20 rounded bg-zinc-950/5 dark:bg-white/5" />
                </div>
                <div className="h-6 w-20 rounded-full bg-zinc-950/10 dark:bg-white/10" />
                <div className="h-4 w-16 rounded bg-zinc-950/5 dark:bg-white/5" />
              </div>
            ))}
          </div>
        </SectionSkeleton>
      </div>

      {/* RunActivityCard */}
      <SectionSkeleton headerWidth="w-24" descWidth="w-64">
        <div className="h-48 rounded-lg bg-zinc-950/5 dark:bg-white/5" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 rounded bg-zinc-950/5 dark:bg-white/5" />
          ))}
        </div>
      </SectionSkeleton>
    </div>
  )
}
