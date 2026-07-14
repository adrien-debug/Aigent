import clsx from 'clsx'

import { surfaceCardClass, surfaceCardHeaderClass } from '@/components/agent-ops/surface-card'

export default function AgentsRegistryLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-8 motion-safe:animate-pulse">
      <span className="sr-only">Loading Copilots…</span>
      
      {/* AgentPageHeader */}
      <div className="mt-2 border-b border-zinc-950/5 pb-5 dark:border-white/5">
        <div className="h-8 w-32 rounded-lg bg-zinc-950/10 dark:bg-white/10" />
        <div className="mt-2 h-4 w-72 rounded-md bg-zinc-950/5 dark:bg-white/5" />
      </div>

      {/* AgentKpiBand — 5 stats */}
      <div className="grid grid-cols-2 gap-8 border-b border-white/5 py-6 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-y-2">
            <div className="h-3 w-16 rounded bg-white/10" />
            <div className="h-9 w-20 rounded-lg bg-white/10" />
          </div>
        ))}
      </div>

      {/* RegistryView skeleton */}
      <div className="space-y-8">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="h-9 w-64 rounded-lg bg-zinc-950/5 dark:bg-white/5" />
            <div className="h-8 w-32 rounded-lg bg-zinc-950/10 dark:bg-white/10" />
          </div>

          <div className={surfaceCardClass}>
            <div className={clsx(surfaceCardHeaderClass, 'px-6 py-4')}>
              <div className="h-5 w-40 rounded bg-zinc-950/10 dark:bg-white/10" />
              <div className="mt-2 h-3.5 w-64 rounded bg-zinc-950/5 dark:bg-white/5" />
            </div>
            <div className="px-6 py-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="h-10 rounded-lg bg-zinc-950/5 dark:bg-white/5" />
                <div className="h-10 rounded-lg bg-zinc-950/5 dark:bg-white/5" />
                <div className="h-10 rounded-lg bg-zinc-950/5 dark:bg-white/5" />
                <div className="h-10 rounded-lg bg-zinc-950/5 dark:bg-white/5" />
              </div>
              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className={clsx(surfaceCardClass, 'flex h-full flex-col')}>
                    <div className="flex grow flex-col p-6">
                      <div className="flex items-start gap-4">
                        <div className="size-11 shrink-0 rounded-xl bg-zinc-950/10 dark:bg-white/10" />
                        <div className="flex min-w-0 flex-1 flex-col space-y-2 pt-1">
                          <div className="h-4 w-3/4 rounded bg-zinc-950/10 dark:bg-white/10" />
                          <div className="h-3 w-1/2 rounded bg-zinc-950/5 dark:bg-white/5" />
                        </div>
                      </div>
                      <div className="mt-6 flex flex-wrap gap-2">
                        <div className="h-5 w-16 rounded-full bg-zinc-950/10 dark:bg-white/10" />
                        <div className="h-5 w-24 rounded bg-zinc-950/5 dark:bg-white/5" />
                      </div>
                    </div>
                    <div className="flex items-center justify-between border-t border-zinc-950/5 bg-zinc-50/50 px-6 py-3.5 dark:border-white/5 dark:bg-white/[0.01]">
                      <div className="flex gap-4">
                        <div className="h-4 w-12 rounded bg-zinc-950/10 dark:bg-white/10" />
                        <div className="h-4 w-12 rounded bg-zinc-950/10 dark:bg-white/10" />
                      </div>
                      <div className="size-4 rounded-sm bg-zinc-950/10 dark:bg-white/10" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
