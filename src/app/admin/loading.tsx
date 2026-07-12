/**
 * Route loading UI for /admin — a calm monochrome skeleton shown while server
 * components fetch from the data layer. Uses the accent hue only as a faint
 * shimmer; respects prefers-reduced-motion (animate-pulse is disabled there).
 *
 * Mirrors the real page structure (src/app/admin/page.tsx) so the skeleton
 * doesn't "jump" once data lands:
 *   1. AgentPageHeader — title + description, hairline underneath.
 *   2. AgentKpiBand — full-bleed row of hairline-separated cells
 *      (`-mx-4 lg:-mx-6`, same as the real band).
 *   3. Two-column card grid — Run activity (wide, with a chart-height block)
 *      on the left, Fleet + Projects stacked on the right.
 */
export default function AdminLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="motion-safe:animate-pulse">
        {/* AgentPageHeader */}
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-zinc-950/5 pb-5 dark:border-white/10">
          <div className="min-w-0">
            <div className="h-7 w-56 rounded-md bg-zinc-950/10 dark:bg-white/10" />
            <div className="mt-3 h-4 w-80 rounded bg-zinc-950/5 dark:bg-white/5" />
          </div>
        </div>

        {/* AgentKpiBand — full-bleed hairline grid of cells */}
        <div className="-mx-4 mt-6 grid grid-cols-2 gap-px bg-zinc-950/10 sm:grid-cols-2 lg:-mx-6 lg:grid-cols-4 dark:bg-white/10">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-y-2 bg-white px-4 py-5 sm:px-6 xl:px-8 dark:bg-zinc-950">
              <div className="h-3.5 w-20 rounded bg-zinc-950/10 dark:bg-white/10" />
              <div className="h-7 w-14 rounded bg-zinc-950/10 dark:bg-white/10" />
            </div>
          ))}
        </div>

        {/* Card grid — run activity (wide) + fleet/projects */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="rounded-xl bg-white p-6 ring-1 ring-zinc-950/5 lg:col-span-2 dark:bg-zinc-950 dark:ring-white/10">
            <div className="h-4 w-32 rounded bg-zinc-950/10 dark:bg-white/10" />
            <div className="mt-2 h-3 w-56 rounded bg-zinc-950/5 dark:bg-white/5" />
            <div className="mt-6 h-[220px] rounded-lg bg-zinc-950/5 dark:bg-white/5" />
          </div>
          <div className="space-y-6">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-xl bg-white p-6 ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10">
                <div className="h-4 w-24 rounded bg-zinc-950/10 dark:bg-white/10" />
                <div className="mt-2 h-3 w-40 rounded bg-zinc-950/5 dark:bg-white/5" />
                <div className="mt-5 space-y-2.5">
                  <div className="h-3 w-full rounded bg-zinc-950/5 dark:bg-white/5" />
                  <div className="h-3 w-5/6 rounded bg-zinc-950/5 dark:bg-white/5" />
                  <div className="h-3 w-2/3 rounded bg-zinc-950/5 dark:bg-white/5" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
