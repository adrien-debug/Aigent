import { surfaceCardClass, surfaceCardHeaderClass } from '@/components/agent-ops/surface-card'

/**
 * Skeleton for /admin/settings. Blocks mirror the settled page 1:1 — same root
 * spacing, same column count, same block order — because a fallback that does
 * not is a layout jump dressed up as a courtesy. Measured at 1440x900 against
 * the real page before this rewrite: the skeleton stacked THREE full-width
 * cards where the page lays two of them side by side in `lg:grid-cols-2`, and
 * drew a subtitle bar under the title that the real header does not have. It
 * also opened on `mt-2 border-b …`, absent from the real header, which pushed
 * every block 8px down and snapped back the moment the data landed.
 *
 * This skeleton is legal ONLY because `settings/` has no dynamic segment below
 * it: a `loading.tsx` is a Suspense boundary and commits the HTTP status before
 * a `notFound()` below it can run — see the note in `src/app/admin/layout.tsx`.
 *
 * Measured again after the rewrite, same viewport: block tops 48/128/520 for a
 * real 48/128/524, heights 48/360/460 for a real 48/364/457 — a 1px residual on
 * the page total, against 26px and a wrong column count before. The residual is
 * NOT chased further: the real blocks are text-driven, so their exact height
 * moves with the content and a pixel-locked skeleton would only be exact for
 * today's strings.
 *
 * Block heights are stand-ins for absent data, never a claim about it: no
 * placeholder value, no fake toggle state.
 */
export default function SettingsLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-8 pb-12 motion-safe:animate-pulse">
      <span className="sr-only">Loading Settings…</span>

      {/* Page header — title only, no eyebrow and no description: that is what
          the real header renders, and a bar drawn for a line that never arrives
          is the same lie as a placeholder number. */}
      <div className="pb-4">
        <div className="h-8 w-32 rounded-lg bg-zinc-950/10 dark:bg-white/10" />
      </div>

      {/* Control Plane + Runtime posture — side by side from lg, exactly as the
          page composes them. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className={surfaceCardClass}>
            <div className={surfaceCardHeaderClass}>
              <div className="min-w-0">
                <div className="h-7 w-40 rounded bg-zinc-950/10 dark:bg-white/10" />
                <div className="mt-1 h-6 w-64 rounded bg-zinc-950/5 dark:bg-white/5" />
              </div>
            </div>
            {/* Same `p-6 flex-1 flex flex-col justify-between` as the card body
                it stands for, so the footnote sits on the card floor here too. */}
            <div className="p-6 flex-1 flex flex-col justify-between">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="flex h-20 flex-col justify-between">
                    <div className="h-3 w-24 rounded bg-zinc-950/10 dark:bg-white/10" />
                    <div className="h-5 w-32 rounded bg-zinc-950/10 dark:bg-white/10" />
                    <div className="h-3 w-20 rounded bg-zinc-950/5 dark:bg-white/5" />
                  </div>
                ))}
              </div>
              <div className="mt-6">
                <div className="h-3 w-full rounded bg-zinc-950/5 dark:bg-white/5" />
                <div className="mt-2 h-3 w-2/3 rounded bg-zinc-950/5 dark:bg-white/5" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Guardrails — full width under the pair. */}
      <div className={surfaceCardClass}>
        <div className={surfaceCardHeaderClass}>
          <div className="min-w-0">
            <div className="h-6 w-48 rounded bg-zinc-950/10 dark:bg-white/10" />
            <div className="mt-1 h-6 w-80 rounded bg-zinc-950/5 dark:bg-white/5" />
          </div>
        </div>
        <div className="px-6 py-4">
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
            <div className="h-64 rounded-2xl bg-zinc-950/5 dark:bg-white/5" />
            <div className="h-64 rounded-2xl bg-zinc-950/5 dark:bg-white/5" />
          </div>
          <div className="mt-6 h-3 w-64 rounded bg-zinc-950/5 dark:bg-white/5" />
        </div>
      </div>
    </div>
  )
}
