import clsx from 'clsx'

/**
 * A static, decorative representation of the project team canvas (the real
 * screen is a ReactFlow graph at /admin/projects/[id]/team — see
 * docs/project-team-canvas.md for the node/edge model this is drawn from).
 * Pure markup, no data, no interactivity — same approach already used by
 * console-preview.tsx: a marketing illustration, not a product screenshot.
 * No status, count, or number here is a real operational reading; the
 * section's visible text carries the same claim so nothing depends on this
 * being seen.
 */

const AGENTS = [
  { name: 'Market Intelligence', role: 'Orchestrator', tone: 'orchestrator' },
  { name: 'Portfolio Risk Guardian', role: 'Risk review', tone: 'member' },
  { name: 'Execution Supervisor', role: 'Execution', tone: 'member' },
  { name: 'Performance Analyst', role: 'Reporting', tone: 'member' },
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
        <div className="mx-auto mb-8 w-fit rounded-lg bg-white/5 px-4 py-2 text-center ring-1 ring-white/10">
          <span className="text-xs font-semibold text-white">TradeAgent</span>
        </div>

        {/* Connecting lines from the project to every agent, and from the
            orchestrator to each team member — the two relations the real
            canvas always draws. */}
        <svg
          className="pointer-events-none absolute inset-x-6 top-[4.5rem] h-[calc(100%-6.5rem)] w-[calc(100%-3rem)] sm:inset-x-8 sm:w-[calc(100%-4rem)]"
          preserveAspectRatio="none"
        >
          <line x1="50%" y1="0" x2="15%" y2="34" stroke="currentColor" strokeWidth="1" className="text-white/15" />
          <line x1="50%" y1="0" x2="38%" y2="34" stroke="currentColor" strokeWidth="1" className="text-white/15" />
          <line x1="50%" y1="0" x2="62%" y2="34" stroke="currentColor" strokeWidth="1" className="text-white/15" />
          <line x1="50%" y1="0" x2="85%" y2="34" stroke="currentColor" strokeWidth="1" className="text-white/15" />
          <line x1="15%" y1="34" x2="38%" y2="34" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" className="text-accent-400/40" />
          <line x1="15%" y1="34" x2="62%" y2="34" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" className="text-accent-400/40" />
          <line x1="15%" y1="34" x2="85%" y2="34" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" className="text-accent-400/40" />
        </svg>

        {/* Agent nodes — orchestrator visually distinct from its team */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {AGENTS.map((agent) => (
            <div
              key={agent.name}
              className={clsx(
                'flex flex-col gap-1.5 rounded-lg p-3 ring-1',
                agent.tone === 'orchestrator'
                  ? 'bg-accent-500/10 ring-accent-500/30'
                  : 'bg-zinc-950/60 ring-white/10',
              )}
            >
              <span
                className={clsx(
                  'size-1.5 shrink-0 rounded-full',
                  agent.tone === 'orchestrator' ? 'bg-accent-400' : 'bg-zinc-600',
                )}
              />
              <span className="text-[11px] leading-snug font-medium text-zinc-200">{agent.name}</span>
              <span
                className={clsx(
                  'text-[10px]',
                  agent.tone === 'orchestrator' ? 'text-accent-400' : 'text-zinc-500',
                )}
              >
                {agent.role}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
