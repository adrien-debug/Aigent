import { surfaceCardClass, surfaceCardHeaderClass } from '@/components/agent-ops/surface-card'

export default function SettingsLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-8 motion-safe:animate-pulse">
      <span className="sr-only">Loading Settings…</span>
      
      {/* AdminPageHeader skeleton */}
      <div className="mt-2 border-b border-zinc-950/5 pb-5 dark:border-white/5">
        <div className="h-8 w-32 rounded-lg bg-zinc-950/10 dark:bg-white/10" />
        <div className="mt-2 h-4 w-64 rounded-md bg-zinc-950/5 dark:bg-white/5" />
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

      {/* Control Plane & Runtime posture cards */}
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className={surfaceCardClass}>
          <div className={surfaceCardHeaderClass}>
            <div className="h-5 w-40 rounded bg-zinc-950/10 dark:bg-white/10" />
            <div className="mt-2 h-3.5 w-72 rounded bg-zinc-950/5 dark:bg-white/5" />
          </div>
          <div className="px-6 py-6">
            <div className="grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j}>
                  <div className="h-3 w-24 rounded bg-zinc-950/10 dark:bg-white/10" />
                  <div className="mt-2 h-4 w-40 rounded bg-zinc-950/10 dark:bg-white/10" />
                </div>
              ))}
            </div>
            <div className="mt-8 h-3 w-3/4 rounded bg-zinc-950/5 dark:bg-white/5" />
          </div>
        </div>
      ))}

      {/* Guardrails card */}
      <div className={surfaceCardClass}>
        <div className={surfaceCardHeaderClass}>
          <div className="h-5 w-48 rounded bg-zinc-950/10 dark:bg-white/10" />
          <div className="mt-2 h-3.5 w-80 rounded bg-zinc-950/5 dark:bg-white/5" />
        </div>
        <div className="px-6 py-6">
          <div className="flex items-center justify-between pb-6">
            <div className="space-y-2">
              <div className="h-4 w-64 rounded bg-zinc-950/10 dark:bg-white/10" />
              <div className="h-3 w-80 rounded bg-zinc-950/5 dark:bg-white/5" />
            </div>
            <div className="flex gap-3">
              <div className="h-6 w-32 rounded bg-zinc-950/10 dark:bg-white/10" />
              <div className="h-6 w-10 rounded-full bg-zinc-950/10 dark:bg-white/10" />
            </div>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-6">
            <div className="h-40 rounded-2xl bg-zinc-950/5 dark:bg-white/5" />
            <div className="h-40 rounded-2xl bg-zinc-950/5 dark:bg-white/5" />
          </div>
          <div className="mt-6 h-3 w-64 rounded bg-zinc-950/5 dark:bg-white/5" />
        </div>
      </div>
    </div>
  )
}
