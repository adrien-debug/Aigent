import type { ReplayComparison } from '@/lib/agent-mission-control/types'

const steps = ['Queued', 'Replayed', 'Verdict'] as const

/**
 * Per-comparison replay lifecycle as compact progress dots
 * (Queued → Replayed → Verdict). Server-safe, purely presentational.
 */
export function ReplayProgressDots({ status }: { status: ReplayComparison['status'] }) {
  // Index of the current step; past `steps.length - 1` means everything is complete.
  const currentIndex = status === 'draft' ? 0 : status === 'ready' ? 1 : steps.length
  const labelStep = Math.min(currentIndex + 1, steps.length)

  return (
    <nav aria-label="Progress" className="flex items-center justify-start">
      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
        Step {labelStep} of {steps.length}
      </p>
      <ol className="ml-8 flex items-center space-x-5">
        {steps.map((name, index) => (
          <li key={name}>
            {index < currentIndex ? (
              <span className="block size-2.5 rounded-full bg-green-500 dark:bg-green-400">
                <span className="sr-only">{name}</span>
              </span>
            ) : index === currentIndex ? (
              <span aria-current="step" className="relative flex items-center justify-center">
                <span aria-hidden="true" className="absolute flex size-5 p-1">
                  <span className="size-full rounded-full bg-green-500/25" />
                </span>
                <span
                  aria-hidden="true"
                  className="relative block size-2.5 rounded-full bg-green-500 dark:bg-green-400"
                />
                <span className="sr-only">{name}</span>
              </span>
            ) : (
              <span className="block size-2.5 rounded-full bg-zinc-950/15 dark:bg-white/15">
                <span className="sr-only">{name}</span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
