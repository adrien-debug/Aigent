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
 * Execution-path flow. Flat steps (no box per step, no box around) — the strip
 * lives directly on the body surface. Accent dot + name + optional status label
 * + detail; the label carries the status.
 *
 * Responsive: the six steps never fit one row below `xl`, so the list is a
 * wrapping grid (2 cols → 3 at sm → 6 at xl). The tall arrow chevron only reads
 * as a connector when the steps share a single row, so it is drawn on `xl` only;
 * on the wrapping tiers the flow is conveyed by reading order. No horizontal
 * scroll at any width — the row never exceeds the container.
 */
export function ArchitectureStrip({
  steps,
}: {
  steps: { name: string; detail?: string; status?: StripStatus }[]
}) {
  return (
    <ol className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 xl:flex xl:items-stretch xl:gap-0">
      {steps.map((step, index) => {
        const status = step.status ?? 'off'
        return (
          <li key={`${step.name}-${index}`} className="flex min-w-0 items-center xl:flex-1">
            <div className="flex min-w-0 flex-col justify-center py-1 xl:min-w-32">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className={clsx('size-1.5 shrink-0 rounded-full', statusDots[status])} />
                <span className="min-w-0 truncate text-sm font-medium text-zinc-950 dark:text-white xl:whitespace-nowrap">
                  {step.name}
                </span>
                {status !== 'ok' ? (
                  <span
                    className={clsx(
                      'shrink-0 text-xs font-medium whitespace-nowrap',
                      statusLabelClasses[status]
                    )}
                  >
                    {statusLabels[status]}
                  </span>
                ) : (
                  <span className="sr-only">({statusLabels.ok})</span>
                )}
              </div>
              {step.detail ? (
                <p className="mt-1 ml-3.5 truncate text-xs text-zinc-500 xl:whitespace-nowrap">{step.detail}</p>
              ) : null}
            </div>
            {index < steps.length - 1 ? (
              <svg
                aria-hidden="true"
                fill="none"
                viewBox="0 0 22 80"
                preserveAspectRatio="none"
                className="mx-4 hidden h-8 w-4 shrink-0 text-zinc-300 xl:block dark:text-white/15"
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
  )
}
