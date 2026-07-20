/**
 * Labeled divider between the stacked sub-sections of a grouped tab (Config,
 * Quality, Release). Gives each absorbed area an anchor + a clear break so the
 * merged page reads as distinct zones rather than a wall.
 */
export function Subsection({ id, label }: { id: string; label: string }) {
  return (
    <div id={id} className="scroll-mt-6 flex items-center gap-4 pt-4">
      <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-zinc-950/5 dark:bg-white/5" />
    </div>
  )
}
