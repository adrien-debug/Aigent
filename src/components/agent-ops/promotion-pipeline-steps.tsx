import { CheckIcon } from '@heroicons/react/20/solid'
import clsx from 'clsx'

import type { PromotionCheck, PromotionCheckId, PromotionGate } from '@/lib/agent-mission-control/types'

/**
 * Promotion pipeline stepper — ecommerce panel stepper (with descriptions)
 * adapted to the doctrine: green = progress accents (blue/violet reserved for
 * runtime/tracing), card surface instead of the pack's bordered wrapper.
 * Steps are derived from the gate's checks and are NOT links. Server-safe.
 */

type StepStatus = 'complete' | 'current' | 'upcoming'

interface PipelineStep {
  id: string
  name: string
  description: string
  status: StepStatus
}

const AUTOMATED_CHECK_IDS: PromotionCheckId[] = [
  'test-pass-rate',
  'unsafe-actions',
  'unauthorized-routes',
  'confirmation-mistakes',
]

function checkPasses(checks: PromotionCheck[], id: PromotionCheckId): boolean {
  return checks.some((check) => check.id === id && check.status === 'pass')
}

function deriveSteps(gate: PromotionGate): PipelineStep[] {
  const automatedDone = AUTOMATED_CHECK_IDS.every((id) => checkPasses(gate.checks, id))
  const shadowDone = checkPasses(gate.checks, 'shadow-agreement')
  const approvalDone = checkPasses(gate.checks, 'human-approval')

  return [
    {
      id: '01',
      name: 'Candidate in gate',
      description: 'Version entered the promotion gate',
      status: 'complete',
    },
    {
      id: '02',
      name: 'Automated checks',
      description: 'Tests, unsafe actions, routes, confirmations',
      status: automatedDone ? 'complete' : 'current',
    },
    {
      id: '03',
      name: 'Shadow window',
      description: 'Agreement vs production over the shadow window',
      status: shadowDone ? 'complete' : automatedDone ? 'current' : 'upcoming',
    },
    {
      id: '04',
      name: 'Human approval',
      description: 'Owner sign-off after gate review',
      status: approvalDone ? 'complete' : automatedDone && shadowDone ? 'current' : 'upcoming',
    },
  ]
}

export function PromotionPipelineSteps({ gate }: { gate: PromotionGate }) {
  const steps = deriveSteps(gate)

  return (
    <nav
      aria-label="Promotion progress"
      className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10"
    >
      <ol role="list" className="overflow-hidden rounded-xl lg:flex">
        {steps.map((step, stepIdx) => (
          <li
            key={step.id}
            className={clsx(
              stepIdx !== 0 && 'border-t border-zinc-950/5 lg:border-t-0 dark:border-white/5',
              'relative overflow-hidden lg:flex-1'
            )}
          >
            {/* Description folds into the tooltip — the strip stays one row tall. */}
            <div aria-current={step.status === 'current' ? 'step' : undefined} title={step.description}>
              {/* Status accent bar: left edge on mobile, bottom edge on lg. */}
              <span
                aria-hidden="true"
                className={clsx(
                  'absolute top-0 left-0 h-full w-1 lg:top-auto lg:bottom-0 lg:h-1 lg:w-full',
                  step.status === 'current' ? 'bg-accent-600 dark:bg-accent-500' : 'bg-transparent'
                )}
              />
              <span
                className={clsx(stepIdx !== 0 && 'lg:pl-9', 'flex items-center gap-3 px-6 py-2.5 text-sm font-medium')}
              >
                <span className="shrink-0">
                  {step.status === 'complete' ? (
                    <span className="flex size-8 items-center justify-center rounded-full bg-accent-600 dark:bg-accent-500">
                      <CheckIcon aria-hidden="true" className="size-4 text-white" />
                    </span>
                  ) : (
                    <span
                      className={clsx(
                        'flex size-8 items-center justify-center rounded-full border-2 text-xs tabular-nums',
                        step.status === 'current'
                          ? 'border-accent-600 dark:border-accent-500'
                          : 'border-zinc-950/15 dark:border-white/15'
                      )}
                    >
                      <span
                        className={clsx(
                          step.status === 'current'
                            ? 'text-accent-600 dark:text-accent-400'
                            : 'text-zinc-500 dark:text-zinc-400'
                        )}
                      >
                        {step.id}
                      </span>
                    </span>
                  )}
                </span>
                <span
                  className={clsx(
                    'min-w-0 truncate text-sm font-medium',
                    step.status === 'complete' && 'text-zinc-950 dark:text-white',
                    step.status === 'current' && 'text-accent-600 dark:text-accent-400',
                    step.status === 'upcoming' && 'text-zinc-500 dark:text-zinc-400'
                  )}
                >
                  {step.name}
                </span>
              </span>

              {stepIdx !== 0 ? (
                /* Curved separator between steps on lg. */
                <div aria-hidden="true" className="absolute inset-0 top-0 left-0 hidden w-3 lg:block">
                  <svg
                    fill="none"
                    viewBox="0 0 12 82"
                    preserveAspectRatio="none"
                    className="size-full text-zinc-950/15 dark:text-white/15"
                  >
                    <path d="M0.5 0V31L10.5 41L0.5 51V82" stroke="currentcolor" vectorEffect="non-scaling-stroke" />
                  </svg>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </nav>
  )
}
