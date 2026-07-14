import clsx from 'clsx'

export default function SettingsLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-8 motion-safe:animate-pulse">
      <span className="sr-only">Loading Settings…</span>
      
      {/* AgentPageHeader */}
      <div className="mt-2 border-b border-zinc-950/5 pb-5 dark:border-white/5">
        <div className="h-8 w-32 rounded-lg bg-zinc-950/10 dark:bg-white/10" />
        <div className="mt-2 h-4 w-64 rounded-md bg-zinc-950/5 dark:bg-white/5" />
      </div>

      {/* AgentKpiBand — 4 stats */}
      <div className="-mx-4 grid grid-cols-1 gap-px bg-zinc-950/5 sm:grid-cols-2 lg:-mx-8 lg:grid-cols-4 dark:bg-white/[0.02]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col items-start gap-y-2 bg-white px-6 py-6 sm:px-8 xl:px-10 dark:bg-zinc-950 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
            <div className="h-3 w-16 rounded bg-zinc-950/10 dark:bg-white/10" />
            <div className="h-9 w-20 rounded-lg bg-zinc-950/10 dark:bg-white/10" />
            <div className="h-3 w-28 rounded bg-zinc-950/5 dark:bg-white/5" />
          </div>
        ))}
      </div>

      {/* Control Plane & Runtime posture cards */}
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/5 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
          <div className="border-b border-zinc-950/5 bg-zinc-50/50 px-6 py-4 dark:border-white/5 dark:bg-white/[0.01]">
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
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/5 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <div className="border-b border-zinc-950/5 bg-zinc-50/50 px-6 py-4 dark:border-white/5 dark:bg-white/[0.01]">
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
