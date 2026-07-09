import { CheckIcon } from '@heroicons/react/20/solid'
import clsx from 'clsx'

import type { BenchmarkRun } from '@/lib/agent-mission-control/types'

type StepStatus = 'complete' | 'current' | 'upcoming'

interface PipelineStep {
  name: 'Queued' | 'Running' | 'Completed'
  status: StepStatus
}

/**
 * Derive the suite-level pipeline position from its runs:
 * - any run still running → "Running" is current;
 * - otherwise any run queued → "Queued" is current;
 * - otherwise every run settled (completed or aborted — an aborted run has
 *   left the pipeline too) → all three steps complete;
 * - no runs at all → nothing entered the pipeline, all steps upcoming.
 */
function deriveSteps(runs: BenchmarkRun[]): PipelineStep[] {
  const anyRunning = runs.some((run) => run.status === 'running')
  const anyQueued = runs.some((run) => run.status === 'queued')
  const allSettled =
    runs.length > 0 && runs.every((run) => run.status === 'completed' || run.status === 'aborted')

  let statuses: [StepStatus, StepStatus, StepStatus]
  if (anyRunning) {
    statuses = ['complete', 'current', 'upcoming']
  } else if (anyQueued) {
    statuses = ['current', 'upcoming', 'upcoming']
  } else if (allSettled) {
    statuses = ['complete', 'complete', 'complete']
  } else {
    statuses = ['upcoming', 'upcoming', 'upcoming']
  }

  return [
    { name: 'Queued', status: statuses[0] },
    { name: 'Running', status: statuses[1] },
    { name: 'Completed', status: statuses[2] },
  ]
}

/**
 * Horizontal circle stepper for a suite's run pipeline: Queued → Running →
 * Completed. Non-interactive status indicator (circles are spans, no links),
 * server-safe.
 */
export function BenchmarkRunSteps({ runs }: { runs: BenchmarkRun[] }) {
  const steps = deriveSteps(runs)

  return (
    <nav aria-label="Run progress">
      <ol role="list" className="flex items-center">
        {steps.map((step, stepIdx) => (
          <li key={step.name} className={clsx('relative', stepIdx !== steps.length - 1 && 'pr-8 sm:pr-20')}>
            <div aria-hidden="true" className="absolute inset-0 flex items-center">
              <div
                className={clsx(
                  'h-0.5 w-full',
                  step.status === 'complete' ? 'bg-green-500' : 'bg-zinc-950/15 dark:bg-white/15'
                )}
              />
            </div>
            {step.status === 'complete' ? (
              <span className="relative flex size-8 items-center justify-center rounded-full bg-green-500">
                <CheckIcon aria-hidden="true" className="size-5 text-white" />
                <span className="sr-only">{step.name}</span>
              </span>
            ) : step.status === 'current' ? (
              <span
                aria-current="step"
                className="relative flex size-8 items-center justify-center rounded-full border-2 border-green-500 bg-white dark:bg-zinc-950"
              >
                <span aria-hidden="true" className="size-2.5 rounded-full bg-green-500" />
                <span className="sr-only">{step.name}</span>
              </span>
            ) : (
              <span className="relative flex size-8 items-center justify-center rounded-full border-2 border-zinc-950/15 bg-white dark:border-white/15 dark:bg-zinc-950">
                <span aria-hidden="true" className="size-2.5 rounded-full bg-transparent" />
                <span className="sr-only">{step.name}</span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
