import clsx from 'clsx'

type StripStatus = 'ok' | 'warn' | 'off'

const statusDots: Record<StripStatus, string> = {
  ok: 'bg-accent-500 dark:bg-accent-400',
  warn: 'bg-accent-500 dark:bg-accent-400',
  off: 'bg-zinc-400 dark:bg-zinc-500',
}

const statusLabels: Record<StripStatus, string> = {
  ok: 'operational',
  warn: 'attention required',
  off: 'inactive',
}

const statusLabelClasses: Record<StripStatus, string> = {
  ok: '',
  warn: 'text-accent-600 dark:text-accent-400',
  off: 'text-zinc-500',
}

/**
 * Execution-path flow. Flat steps (no box per step, no box around) separated by
 * a tall arrow chevron — the strip lives directly on the body surface. Accent
 * dot + name + optional status label + detail; the label carries the status.
 */
export function ArchitectureStrip({
  steps,
}: {
  steps: { name: string; detail?: string; status?: StripStatus }[]
}) {
  return (
    <div className="overflow-x-auto">
      <ol className="flex min-w-max items-stretch">
        {steps.map((step, index) => {
          const status = step.status ?? 'off'
          return (
            <li key={`${step.name}-${index}`} className="flex flex-1 items-center">
              <div className="flex min-w-32 flex-col justify-center py-1">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className={clsx('size-1.5 shrink-0 rounded-full', statusDots[status])} />
                  <span className="text-sm font-medium whitespace-nowrap text-zinc-950 dark:text-white">
                    {step.name}
                  </span>
                  {status !== 'ok' ? (
                    <span className={clsx('text-xs font-medium whitespace-nowrap', statusLabelClasses[status])}>
                      {statusLabels[status]}
                    </span>
                  ) : (
                    <span className="sr-only">({statusLabels.ok})</span>
                  )}
                </div>
                {step.detail ? (
                  <p className="mt-1 ml-3.5 text-xs whitespace-nowrap text-zinc-500">{step.detail}</p>
                ) : null}
              </div>
              {index < steps.length - 1 ? (
                <svg
                  aria-hidden="true"
                  fill="none"
                  viewBox="0 0 22 80"
                  preserveAspectRatio="none"
                  className="mx-4 h-8 w-4 shrink-0 text-zinc-300 dark:text-white/15"
                >
                  <path
                    d="M0 -2L20 40L0 82"
                    stroke="currentColor"
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
