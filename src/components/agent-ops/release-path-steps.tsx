import { CheckIcon } from '@heroicons/react/24/solid'
import clsx from 'clsx'

import { surfaceCardClass } from '@/components/agent-ops/surface-card'

type ReleaseStage = 'draft' | 'beta' | 'production'
type StepStatus = 'complete' | 'current' | 'upcoming'

const STEPS: { id: string; name: string; stage: ReleaseStage }[] = [
  { id: '01', name: 'Draft', stage: 'draft' },
  { id: '02', name: 'Beta', stage: 'beta' },
  { id: '03', name: 'Production', stage: 'production' },
]

/**
 * Release path strip: Draft → Beta → Production, slimmed to a single-row
 * stepper on the doctrine card surface. Stages before the candidate are
 * complete, the candidate stage is current, later stages upcoming. A
 * 'production' candidate means nothing is in flight — the path is fully
 * shipped, so every step renders complete (no current step).
 * Non-interactive (no links), server-safe.
 */
export function ReleasePathSteps({ candidateStage }: { candidateStage: ReleaseStage }) {
  const candidateIndex = STEPS.findIndex((step) => step.stage === candidateStage)

  return (
    <nav
      aria-label="Release progress"
      className={clsx('overflow-hidden', surfaceCardClass)}
    >
      <ol role="list" className="divide-y divide-zinc-950/5 md:flex md:divide-y-0 dark:divide-white/5">
        {STEPS.map((step, stepIdx) => {
          const status: StepStatus =
            stepIdx < candidateIndex || candidateStage === 'production'
              ? 'complete'
              : stepIdx === candidateIndex
                ? 'current'
                : 'upcoming'

          return (
            <li key={step.id} className="relative md:flex md:flex-1">
              <div
                aria-current={status === 'current' ? 'step' : undefined}
                className="flex items-center gap-3 px-6 py-2.5 text-sm font-medium"
              >
                {status === 'complete' ? (
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-600 dark:bg-accent-500">
                    <CheckIcon aria-hidden="true" className="size-4 text-white" />
                  </span>
                ) : (
                  <span
                    className={clsx(
                      'flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-xs tabular-nums',
                      status === 'current'
                        ? 'border-accent-600 text-accent-600 dark:border-accent-400 dark:text-accent-400'
                        : 'border-zinc-950/15 text-zinc-500 dark:border-white/15 dark:text-zinc-400'
                    )}
                  >
                    {step.id}
                  </span>
                )}
                <span
                  className={clsx(
                    status === 'complete' && 'text-zinc-950 dark:text-white',
                    status === 'current' && 'text-accent-600 dark:text-accent-400',
                    status === 'upcoming' && 'text-zinc-500 dark:text-zinc-400'
                  )}
                >
                  {step.name}
                </span>
              </div>

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
