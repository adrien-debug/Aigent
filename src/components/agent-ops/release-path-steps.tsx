import { CheckIcon } from '@heroicons/react/24/solid'

type ReleaseStage = 'draft' | 'beta' | 'production'
type StepStatus = 'complete' | 'current' | 'upcoming'

const STEPS: { id: string; name: string; stage: ReleaseStage }[] = [
  { id: '01', name: 'Draft', stage: 'draft' },
  { id: '02', name: 'Beta', stage: 'beta' },
  { id: '03', name: 'Production', stage: 'production' },
]

/**
 * Release path panel stepper: Draft → Beta → Production. Stages before the
 * candidate are complete, the candidate stage is current, later stages are
 * upcoming. A 'production' candidate means nothing is in flight — the path
 * is fully shipped, so every step renders complete (no current step).
 * Non-interactive status indicator (no links), server-safe.
 */
export function ReleasePathSteps({ candidateStage }: { candidateStage: ReleaseStage }) {
  const candidateIndex = STEPS.findIndex((step) => step.stage === candidateStage)

  return (
    <nav aria-label="Release progress">
      <ol
        role="list"
        className="divide-y divide-zinc-950/10 rounded-md border border-zinc-950/10 bg-white md:flex md:divide-y-0 dark:divide-white/15 dark:border-white/15 dark:bg-zinc-950"
      >
        {STEPS.map((step, stepIdx) => {
          const status: StepStatus =
            stepIdx < candidateIndex || candidateStage === 'production'
              ? 'complete'
              : stepIdx === candidateIndex
                ? 'current'
                : 'upcoming'

          return (
            <li key={step.id} className="relative md:flex md:flex-1">
              {status === 'complete' ? (
                <div className="flex w-full items-center">
                  <span className="flex items-center px-6 py-4 text-sm font-medium">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-green-600 dark:bg-green-500">
                      <CheckIcon aria-hidden="true" className="size-6 text-white" />
                    </span>
                    <span className="ml-4 text-sm font-medium text-zinc-950 dark:text-white">{step.name}</span>
                  </span>
                </div>
              ) : status === 'current' ? (
                <div aria-current="step" className="flex items-center px-6 py-4 text-sm font-medium">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-green-600 dark:border-green-400">
                    <span className="text-green-600 dark:text-green-400">{step.id}</span>
                  </span>
                  <span className="ml-4 text-sm font-medium text-green-600 dark:text-green-400">{step.name}</span>
                </div>
              ) : (
                <div className="flex items-center">
                  <span className="flex items-center px-6 py-4 text-sm font-medium">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-zinc-950/10 dark:border-white/15">
                      <span className="text-zinc-500 dark:text-zinc-400">{step.id}</span>
                    </span>
                    <span className="ml-4 text-sm font-medium text-zinc-500 dark:text-zinc-400">{step.name}</span>
                  </span>
                </div>
              )}

              {stepIdx !== STEPS.length - 1 ? (
                <div aria-hidden="true" className="absolute top-0 right-0 hidden h-full w-5 md:block">
                  <svg
                    fill="none"
                    viewBox="0 0 22 80"
                    preserveAspectRatio="none"
                    className="size-full text-zinc-950/10 dark:text-white/15"
                  >
                    <path
                      d="M0 -2L20 40L0 82"
                      stroke="currentcolor"
                      vectorEffect="non-scaling-stroke"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
