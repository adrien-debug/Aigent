import clsx from 'clsx'

/**
 * A static, decorative representation of the improvement loop (analyze →
 * propose → create V2 → compare → decide — see docs/agent-authoring.md §1c
 * and src/components/agent-ops/improve-workbench.tsx for the real screen).
 * Pure markup, no data, no interactivity — same approach already used by
 * console-preview.tsx: a marketing illustration, not a product screenshot.
 * Vertical on mobile so every label and detail stays fully readable; a row
 * of five only above `lg`, where there is room for it.
 */

const STEPS = [
  { label: 'Analyze', detail: 'Root-causes failing runs, tests, and benchmark scores' },
  { label: 'Propose', detail: 'Drafts a structured change to the agent manifest' },
  { label: 'Create V2', detail: 'A new draft version — the current one keeps running' },
  { label: 'Compare', detail: 'Both versions, side by side, on the same evidence' },
  { label: 'Decide', detail: 'A human approves or rejects — nothing ships on its own' },
] as const

export function ImproveLoopPreview({ className }: { className?: string }) {
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
        <span className="ml-3 text-xs font-medium text-zinc-500">Improvement loop — market-intelligence</span>
      </div>

      <div className="grid grid-cols-1 gap-px bg-white/5 lg:grid-cols-5">
        {STEPS.map((step, i) => (
          <div key={step.label} className="flex flex-col gap-2 bg-zinc-900/80 p-4">
            <div className="flex items-center gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-[11px] font-semibold text-accent-400">
                {i + 1}
              </span>
              <span className="text-sm font-semibold text-white">{step.label}</span>
            </div>
            <p className="text-xs leading-snug text-zinc-500">{step.detail}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-white/10 bg-zinc-900/80 px-4 py-3">
        <span className="text-xs text-zinc-500">Proposal awaiting decision</span>
        <span className="rounded-full bg-accent-500/10 px-2.5 py-1 text-[11px] font-semibold text-accent-400 ring-1 ring-accent-500/25 ring-inset">
          v1.1.0-draft
        </span>
      </div>
    </div>
  )
}
