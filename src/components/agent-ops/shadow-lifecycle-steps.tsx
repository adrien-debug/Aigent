import clsx from 'clsx'

import type { ShadowExperiment } from '@/lib/agent-mission-control/types'

type StepStatus = 'complete' | 'current' | 'upcoming'

interface LifecycleStep {
  id: string
  name: string
  status: StepStatus
}

/**
 * Derive the three lifecycle step statuses defensively from the experiment:
 * 1. Sampling — complete once runs are sampled and the experiment finished
 *    (or agreement is measured); current while the experiment is running.
 * 2. Agreement threshold — complete when agreement meets the promotion
 *    threshold; current while running below it.
 * 3. Promotion ready — complete only when agreement is met AND zero unsafe
 *    proposals were recorded (the experiment card's warning explains why
 *    an agreement-met-but-unsafe experiment stays upcoming).
 */
function deriveSteps(experiment: ShadowExperiment): LifecycleStep[] {
  const agreementMet = experiment.agreementRate >= experiment.agreementThreshold
  const agreementMeasured = experiment.sampledRunCount > 0 && experiment.agreementRate > 0

  let sampling: StepStatus = 'upcoming'
  if (experiment.sampledRunCount > 0 && (experiment.status === 'completed' || agreementMeasured)) {
    sampling = 'complete'
  } else if (experiment.status === 'running') {
    sampling = 'current'
  }

  let agreement: StepStatus = 'upcoming'
  if (agreementMet) {
    agreement = 'complete'
  } else if (experiment.status === 'running') {
    agreement = 'current'
  }

  const promotion: StepStatus = agreementMet && experiment.unsafeProposalCount === 0 ? 'complete' : 'upcoming'

  return [
    { id: '01', name: 'Sampling', status: sampling },
    { id: '02', name: 'Agreement threshold', status: agreement },
    { id: '03', name: 'Promotion ready', status: promotion },
  ]
}

const stepClasses: Record<StepStatus, { border: string; id: string; name: string }> = {
  complete: {
    border: 'border-accent-500',
    id: 'text-accent-600 dark:text-accent-400',
    name: 'text-zinc-950 dark:text-white',
  },
  current: {
    border: 'border-accent-400',
    id: 'text-accent-600 dark:text-accent-400',
    name: 'text-zinc-950 dark:text-white',
  },
  upcoming: {
    border: 'border-zinc-950/10 dark:border-white/10',
    id: 'text-zinc-500',
    name: 'text-zinc-500',
  },
}

/**
 * Shadow experiment lifecycle stepper: Sampling → Agreement threshold →
 * Promotion ready. Non-interactive status indicator (no links), server-safe.
 */
export function ShadowLifecycleSteps({ experiment }: { experiment: ShadowExperiment }) {
  const steps = deriveSteps(experiment)

  return (
    <nav aria-label="Progress">
      <ol role="list" className="space-y-4 md:flex md:space-y-0 md:space-x-8">
        {steps.map((step) => {
          const classes = stepClasses[step.status]
          return (
            <li key={step.name} className="md:flex-1">
              <div
                aria-current={step.status === 'current' ? 'step' : undefined}
                className={clsx(
                  'flex flex-col border-l-4 py-2 pl-4 md:border-t-4 md:border-l-0 md:pt-4 md:pb-0 md:pl-0',
                  classes.border
                )}
              >
                <span className={clsx('text-sm font-medium', classes.id)}>{step.id}</span>
                <span className={clsx('text-sm font-medium', classes.name)}>{step.name}</span>
              </div>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
