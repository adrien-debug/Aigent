import { CheckCircleIcon } from '@heroicons/react/20/solid'

import type { AgentManifest } from '@/lib/agent-mission-control/types'

type StepStatus = 'complete' | 'current' | 'upcoming'

const statusLabels: Record<StepStatus, string> = {
  complete: 'Complete',
  current: 'Current step',
  upcoming: 'Upcoming',
}

/**
 * Vertical completeness checklist for a compiled manifest, derived from the
 * manifest data itself — a section is complete when it is actually set. The
 * first incomplete section is the "current" step; later ones stay "upcoming".
 * Server-safe: no client JS, purely derived from the manifest prop.
 */
function deriveSteps(manifest: AgentManifest): { name: string; status: StepStatus }[] {
  const checks: { name: string; complete: boolean }[] = [
    { name: 'Allowed routes', complete: manifest.allowedRoutes.length > 0 },
    { name: 'Forbidden actions', complete: manifest.forbiddenActions.length > 0 },
    {
      // A 'never' policy with an empty always-confirm list means confirmations
      // were never really configured — treated as incomplete.
      name: 'Confirmation policy',
      complete: manifest.confirmationPolicy !== 'never' || manifest.alwaysConfirmActions.length > 0,
    },
    { name: 'Memory sources', complete: manifest.memorySources.length > 0 },
    {
      name: 'Output contract',
      complete: Boolean(manifest.outputContract.schemaName) || manifest.outputContract.invariants.length > 0,
    },
  ]

  const firstIncomplete = checks.findIndex((check) => !check.complete)

  return checks.map((check, index) => ({
    name: check.name,
    status: check.complete ? 'complete' : index === firstIncomplete ? 'current' : 'upcoming',
  }))
}

export function ManifestCompleteness({ manifest }: { manifest: AgentManifest }) {
  const steps = deriveSteps(manifest)

  return (
    <nav aria-label="Manifest completeness">
      <ol role="list" className="space-y-6">
        {steps.map((step) => (
          <li key={step.name}>
            {step.status === 'complete' ? (
              <div className="flex items-start">
                <span className="relative flex size-5 shrink-0 items-center justify-center">
                  <CheckCircleIcon aria-hidden="true" className="size-5 text-accent-600 dark:text-accent-400" />
                </span>
                <span className="ml-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                  {step.name}
                  <span className="sr-only"> — {statusLabels[step.status]}</span>
                </span>
              </div>
            ) : step.status === 'current' ? (
              <div aria-current="step" className="flex items-start">
                <span aria-hidden="true" className="relative flex size-5 shrink-0 items-center justify-center">
                  <span className="absolute size-4 rounded-full bg-accent-500/25" />
                  <span className="relative block size-2 rounded-full bg-accent-600 dark:bg-accent-400" />
                </span>
                <span className="ml-3 text-sm font-medium text-accent-700 dark:text-accent-400">
                  {step.name}
                  <span className="sr-only"> — {statusLabels[step.status]}</span>
                </span>
              </div>
            ) : (
              <div className="flex items-start">
                <span aria-hidden="true" className="relative flex size-5 shrink-0 items-center justify-center">
                  <span className="size-2 rounded-full bg-zinc-950/15 dark:bg-white/15" />
                </span>
                <span className="ml-3 text-sm font-medium text-zinc-400 dark:text-zinc-500">
                  {step.name}
                  <span className="sr-only"> — {statusLabels[step.status]}</span>
                </span>
              </div>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
