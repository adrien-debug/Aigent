'use client'

import clsx from 'clsx'
import { usePathname } from 'next/navigation'
import { Link } from '@/components/catalyst/link'

const TABS = [
  { label: 'Overview', segment: '' },
  { label: 'Manifest', segment: 'manifest' },
  { label: 'Tools', segment: 'tools' },
  { label: 'Tests', segment: 'tests' },
  { label: 'Runs', segment: 'runs' },
  { label: 'Benchmarks', segment: 'benchmarks' },
  { label: 'Replay', segment: 'replay' },
  { label: 'Shadow', segment: 'shadow' },
  { label: 'Versions', segment: 'versions' },
  { label: 'Publish', segment: 'publish' },
] as const

export function CopilotTabs({ copilotId }: { copilotId: string }) {
  const pathname = usePathname()
  const base = `/admin/agents/${copilotId}`

  return (
    <nav aria-label="Copilot sections" className="overflow-x-auto">
      <div className="w-max min-w-full border-b border-zinc-950/10 dark:border-white/10">
        <div className="-mb-px flex gap-6">
          {TABS.map(({ label, segment }) => {
            const href = segment ? `${base}/${segment}` : base
            const current = segment
              ? pathname === href || pathname.startsWith(`${href}/`)
              : pathname === base
            return (
              <Link
                key={label}
                href={href}
                aria-current={current ? 'page' : undefined}
                className={clsx(
                  'border-b-2 px-1 py-3 text-sm font-medium whitespace-nowrap transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-500',
                  current
                    ? 'border-green-500 text-zinc-950 dark:text-white'
                    : 'border-transparent text-zinc-500 hover:border-zinc-950/20 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-white/20 dark:hover:text-zinc-200'
                )}
              >
                {label}
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
