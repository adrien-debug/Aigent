import { CheckIcon } from '@heroicons/react/20/solid'
import clsx from 'clsx'

import { Link } from '@/components/catalyst/link'

type StepStatus = 'complete' | 'current' | 'upcoming'

const statusLabels: Record<StepStatus, string> = {
  complete: 'Complete',
  current: 'Current step',
  upcoming: 'Upcoming',
}

/**
 * Vertical onboarding stepper for the sparse-draft copilot overview.
 * Server-safe: statuses derive from the data the page already fetched.
 */
export function OnboardingSteps({
  copilotId,
  hasManifest,
  toolCount,
  testSuiteCount,
  hasProductionVersion,
}: {
  copilotId: string
  hasManifest: boolean
  toolCount: number
  testSuiteCount: number
  hasProductionVersion: boolean
}) {
  const base = `/admin/agents/${copilotId}`

  const doneFlags = [hasManifest, toolCount > 0, testSuiteCount > 0, hasProductionVersion]
  const firstIncomplete = doneFlags.findIndex((done) => !done)

  const steps: { name: string; description: string; href: string; status: StepStatus }[] = [
    {
      name: 'Write the manifest',
      description: 'Routes, guardrails and the output contract.',
      href: `${base}/manifest`,
      status: 'upcoming',
    },
    {
      name: 'Enable tools',
      description: 'Connect the read and write tools the copilot needs.',
      href: `${base}/tools`,
      status: 'upcoming',
    },
    {
      name: 'Add test suites',
      description: 'Cover the core behaviors and safety cases before any traffic.',
      href: `${base}/tests`,
      status: 'upcoming',
    },
    {
      name: 'Promote a version',
      description: 'Open the promotion gate and ship to production.',
      href: `${base}/publish`,
      status: 'upcoming',
    },
  ].map((step, index) => ({
    ...step,
    status: doneFlags[index] ? 'complete' : index === firstIncomplete ? 'current' : 'upcoming',
  }))

  return (
    <nav aria-label="Onboarding progress">
      <ol role="list" className="overflow-hidden">
        {steps.map((step, stepIdx) => (
          <li key={step.name} className={clsx(stepIdx !== steps.length - 1 && 'pb-10', 'relative')}>
            {stepIdx !== steps.length - 1 ? (
              <div
                aria-hidden="true"
                className={clsx(
                  'absolute top-4 left-4 mt-0.5 -ml-px h-full w-0.5',
                  step.status === 'complete' ? 'bg-green-500' : 'bg-zinc-950/15 dark:bg-white/15'
                )}
              />
            ) : null}
            <Link
              href={step.href}
              aria-current={step.status === 'current' ? 'step' : undefined}
              className="group relative flex items-start"
            >
              <span aria-hidden="true" className="flex h-9 items-center">
                {step.status === 'complete' ? (
                  <span className="relative z-10 flex size-8 items-center justify-center rounded-full bg-green-600 transition-colors duration-150 group-hover:bg-green-500 dark:bg-green-500 dark:group-hover:bg-green-400">
                    <CheckIcon aria-hidden="true" className="size-5 text-white" />
                  </span>
                ) : step.status === 'current' ? (
                  <span className="relative z-10 flex size-8 items-center justify-center rounded-full border-2 border-green-600 bg-white dark:border-green-500 dark:bg-zinc-950">
                    <span className="size-2.5 rounded-full bg-green-600 dark:bg-green-500" />
                  </span>
                ) : (
                  <span className="relative z-10 flex size-8 items-center justify-center rounded-full border-2 border-zinc-950/15 bg-white dark:border-white/15 dark:bg-zinc-950">
                    <span className="size-2.5 rounded-full bg-transparent transition-colors duration-150 group-hover:bg-zinc-950/15 dark:group-hover:bg-white/15" />
                  </span>
                )}
              </span>
              <span className="ml-4 flex min-w-0 flex-col">
                <span
                  className={clsx(
                    'text-sm font-medium',
                    step.status === 'complete' && 'text-zinc-950 dark:text-white',
                    step.status === 'current' && 'text-green-700 dark:text-green-400',
                    step.status === 'upcoming' && 'text-zinc-500 dark:text-zinc-400'
                  )}
                >
                  {step.name}
                  <span className="sr-only"> — {statusLabels[step.status]}</span>
                </span>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">{step.description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  )
}
