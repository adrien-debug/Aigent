/**
 * Route loading UI for /admin — a calm monochrome skeleton shown while server
 * components fetch from the data layer. Uses the accent hue only as a faint
 * shimmer; respects prefers-reduced-motion (animate-pulse is disabled there).
 */
export default function AdminLoading() {
  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="motion-safe:animate-pulse">
        <div className="h-7 w-56 rounded-md bg-white/10" />
        <div className="mt-3 h-4 w-80 rounded bg-white/5" />
        <div className="mt-8 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-zinc-950 ring-1 ring-white/5" />
          ))}
        </div>
      </div>
    </div>
  )
}
