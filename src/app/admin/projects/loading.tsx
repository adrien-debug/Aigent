import clsx from 'clsx'

import { surfaceCardClass } from '@/components/agent-ops/surface-card'

export default function ProjectsRegistryLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-8 motion-safe:animate-pulse">
      <span className="sr-only">Loading Projects…</span>
      
      {/* AgentPageHeader */}
      <div className="mt-2 flex items-center justify-between border-b border-zinc-950/5 pb-5 dark:border-white/5">
        <div>
          <div className="h-8 w-32 rounded-lg bg-zinc-950/10 dark:bg-white/10" />
          <div className="mt-2 h-4 w-72 rounded-md bg-zinc-950/5 dark:bg-white/5" />
        </div>
        <div className="h-8 w-28 rounded-lg bg-zinc-950/10 dark:bg-white/10" />
      </div>

      {/* AgentKpiBand — 4 stats */}
      <div className="grid grid-cols-2 gap-8 border-b border-white/5 py-6 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-y-2">
            <div className="h-3 w-16 rounded bg-white/10" />
            <div className="h-9 w-20 rounded-lg bg-white/10" />
          </div>
        ))}
      </div>

      {/* Project Cards Grid */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={clsx(surfaceCardClass, 'flex h-full flex-col')}>
            <div className="relative h-28 bg-zinc-950/5 dark:bg-white/5" />
            <div className="relative z-10 -mt-8 ml-6 size-14 rounded bg-zinc-200 ring-2 ring-white dark:bg-zinc-800 dark:ring-zinc-950" />
            <div className="flex flex-1 flex-col px-6 pt-3 pb-6">
              <div className="h-5 w-40 rounded bg-zinc-950/10 dark:bg-white/10" />
              <div className="mt-2 h-3.5 w-32 rounded bg-zinc-950/5 dark:bg-white/5" />
              <div className="mt-4 space-y-2">
                <div className="h-3.5 w-full rounded bg-zinc-950/5 dark:bg-white/5" />
                <div className="h-3.5 w-5/6 rounded bg-zinc-950/5 dark:bg-white/5" />
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
    </div>
  )
}
