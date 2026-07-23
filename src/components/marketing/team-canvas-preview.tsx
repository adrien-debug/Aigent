import clsx from 'clsx'

/**
 * A static, decorative preview of the project team canvas (the real screen
 * is a ReactFlow graph at /admin/projects/[id]/team — see
 * docs/project-team-canvas.md). Pure markup, no data, no interactivity, same
 * doctrine as console-preview.tsx: this is not a screenshot, it's a
 * hand-built approximation of the real graph's node/edge structure.
 */

const NODES = [
  { name: 'Market Intelligence', role: 'Active', tone: 'live' },
  { name: 'Portfolio Risk Guardian', role: 'Active', tone: 'live' },
  { name: 'Execution Supervisor', role: 'Draft', tone: 'draft' },
  { name: 'Performance Analyst', role: 'Draft', tone: 'draft' },
] as const

export function TeamCanvasPreview({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        'overflow-hidden rounded-xl bg-zinc-900/80 shadow-2xl ring-1 ring-white/10 backdrop-blur-sm',
        className,
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-white/10 bg-white/[0.04] px-4 py-3">
        <span className="size-2.5 rounded-full bg-zinc-700" />
        <span className="size-2.5 rounded-full bg-zinc-700" />
        <span className="size-2.5 rounded-full bg-zinc-700" />
        <span className="ml-3 text-xs font-medium text-zinc-500">My Team — TradeAgent</span>
      </div>

      <div className="relative bg-zinc-900/80 p-6 sm:p-8">
        {/* Project node */}
        <div className="mx-auto mb-6 w-fit rounded-lg bg-white/5 px-4 py-2 text-center ring-1 ring-white/10">
          <span className="text-xs font-semibold text-white">TradeAgent</span>
        </div>

        {/* Connecting lines (decorative) */}
        <div aria-hidden="true" className="absolute inset-x-0 top-16 h-6 sm:top-[4.5rem]">
          <svg className="h-full w-full" preserveAspectRatio="none">
            <line x1="50%" y1="0" x2="15%" y2="100%" stroke="currentColor" strokeWidth="1" className="text-white/10" />
            <line x1="50%" y1="0" x2="38%" y2="100%" stroke="currentColor" strokeWidth="1" className="text-white/10" />
            <line x1="50%" y1="0" x2="62%" y2="100%" stroke="currentColor" strokeWidth="1" className="text-white/10" />
            <line x1="50%" y1="0" x2="85%" y2="100%" stroke="currentColor" strokeWidth="1" className="text-white/10" />
          </svg>
        </div>

        {/* Agent nodes */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {NODES.map((node) => (
            <div
              key={node.name}
              className="flex flex-col gap-1.5 rounded-lg bg-zinc-950/60 p-3 ring-1 ring-white/10"
            >
              <span
                className={clsx(
                  'size-1.5 shrink-0 rounded-full',
                  node.tone === 'live' ? 'bg-accent-400' : 'bg-zinc-600',
                )}
              />
              <span className="text-[11px] leading-snug font-medium text-zinc-200">{node.name}</span>
              <span className="text-[10px] text-zinc-500">{node.role}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
