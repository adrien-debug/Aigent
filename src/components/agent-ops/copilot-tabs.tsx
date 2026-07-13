'use client'

import clsx from 'clsx'
import { usePathname } from 'next/navigation'
import { Link } from '@/components/catalyst/link'

// Grouped tabs. Each groups related pages as sections of one host page:
//   Config  = manifest + tools        Quality = tests + benchmarks + shadow + replay
//   Improve = the improvement loop    Release = versions + publish
const TABS = [
  { label: 'Overview', segment: '' },
  { label: 'Config', segment: 'manifest' },
  { label: 'Runs', segment: 'runs' },
  { label: 'Quality', segment: 'tests' },
  { label: 'Improve', segment: 'improve' },
  { label: 'Release', segment: 'versions' },
] as const

// The Builder tab is exclusive to the Agent Builder Copilot (the meta copilot
// that drafts other copilots) — a normal copilot has no builder flow, so this
// tab is appended only when `showBuilder` is set (see the [id] layout).
const BUILDER_TAB = { label: 'Builder', segment: 'builder' } as const

export function CopilotTabs({ copilotId, showBuilder = false }: { copilotId: string; showBuilder?: boolean }) {
  const pathname = usePathname()
  const base = `/admin/agents/${copilotId}`
  const tabs = showBuilder ? [...TABS, BUILDER_TAB] : TABS

  return (
    <nav aria-label="Copilot sections" className="overflow-x-auto">
      <div className="w-max min-w-full border-b border-zinc-950/10 dark:border-white/10">
        <div className="-mb-px flex gap-6">
          {tabs.map(({ label, segment }) => {
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
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500',
                  current
                    ? 'border-accent-500 text-zinc-950 dark:text-white'
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
