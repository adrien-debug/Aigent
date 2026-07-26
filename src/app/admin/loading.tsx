import { surfaceSectionClass, surfaceSectionHeaderClass } from '@/components/agent-ops/surface-card'

/**
 * Fallback for the WHOLE /admin subtree — Next.js reuses the nearest `loading`
 * boundary, so this one also covers Telemetry, Factory, Agents, Projects and
 * Performance. It therefore cannot name a page: announcing "Loading Dashboard…"
 * while Telemetry is being fetched is a lie told to the only users who depend
 * on that announcement. Segment-level `loading.tsx` files (settings, project
 * team) sit closer to their route and do name it — correctly.
 */
export default function AdminSectionLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-8 pb-12 motion-safe:animate-pulse">
      <span className="sr-only">Loading…</span>

      <div className="mt-2 border-b border-zinc-950/5 pb-5 dark:border-white/5">
        <div className="h-3 w-20 rounded bg-zinc-950/10 dark:bg-white/10" />
        <div className="mt-3 h-8 w-80 max-w-full rounded-lg bg-zinc-950/10 dark:bg-white/10" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 border-b border-white/5 py-6 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-y-2">
            <div className="h-3 w-16 rounded bg-white/10" />
            <div className="h-9 w-20 rounded-lg bg-white/10" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className={`xl:col-span-2 ${surfaceSectionClass}`}>
          <div className={surfaceSectionHeaderClass}>
            <div className="h-5 w-32 rounded bg-zinc-950/10 dark:bg-white/10" />
          </div>
          <div className="flex flex-col gap-3 px-6 pb-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-zinc-950/5 dark:bg-white/5" />
            ))}
          </div>
        </div>
        <div className={surfaceSectionClass}>
          <div className={surfaceSectionHeaderClass}>
            <div className="h-5 w-40 rounded bg-zinc-950/10 dark:bg-white/10" />
          </div>
          <div className="flex flex-col gap-3 px-6 pb-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-zinc-950/5 dark:bg-white/5" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
