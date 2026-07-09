import { ArrowLongRightIcon } from '@heroicons/react/16/solid'
import clsx from 'clsx'

type StripStatus = 'ok' | 'warn' | 'off'

const statusDots: Record<StripStatus, string> = {
  ok: 'bg-green-500 dark:bg-green-400',
  warn: 'bg-amber-500 dark:bg-amber-400',
  off: 'bg-zinc-400 dark:bg-zinc-500',
}

const statusLabels: Record<StripStatus, string> = {
  ok: 'operational',
  warn: 'attention required',
  off: 'inactive',
}

const statusLabelClasses: Record<StripStatus, string> = {
  ok: '',
  warn: 'text-amber-600 dark:text-amber-400',
  off: 'text-zinc-500',
}

export function ArchitectureStrip({
  steps,
}: {
  steps: { name: string; detail?: string; status?: StripStatus }[]
}) {
  return (
    <div className="overflow-x-auto">
      <ol className="flex min-w-max items-stretch gap-3 py-1">
        {steps.map((step, index) => {
          const status = step.status ?? 'off'
          return (
            <li key={`${step.name}-${index}`} className="flex items-center gap-3">
              <div className="flex h-full min-w-32 flex-col justify-center rounded-lg px-4 py-3 ring-1 ring-zinc-950/10 dark:ring-white/10">
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
                  <p className="mt-1 text-xs whitespace-nowrap text-zinc-500">{step.detail}</p>
                ) : null}
              </div>
              {index < steps.length - 1 ? (
                <ArrowLongRightIcon aria-hidden="true" className="size-4 shrink-0 text-zinc-400 dark:text-zinc-600" />
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
