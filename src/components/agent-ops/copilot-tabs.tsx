'use client'

import clsx from 'clsx'
import { usePathname } from 'next/navigation'
import { Link } from '@/components/catalyst/link'

// Grouped tabs. Each groups related pages as sections of one host page:
//   Manifest = manifest + tools        Quality = tests + benchmarks + shadow + replay
//   Improve  = the improvement loop    Release  = versions + publish
// Order follows the copilot lifecycle: frame (Overview/Manifest) → verify
// (Quality) → observe (Runs) → iterate (Improve) → ship (Release).
const TABS = [
  { label: 'Overview', segment: '' },
  { label: 'Manifest', segment: 'manifest' },
  { label: 'Quality', segment: 'tests' },
  { label: 'Runs', segment: 'runs' },
  { label: 'Improve', segment: 'improve' },
  { label: 'Release', segment: 'versions' },
] as const

export function CopilotTabs({ copilotId }: { copilotId: string }) {
  const pathname = usePathname()
  const base = `/admin/agents/${copilotId}`

  return (
    // The hairline underline must span the FULL width even when the tab row is
    // narrower than the viewport, so it lives on the nav (block-level, 100% wide)
    // rather than on the inline scroll track. The scroll track carries only the
    // tab links; on mobile it scrolls horizontally inside this bounded box —
    // never the page body. `no-scrollbar` keeps the affordance clean; the
    // clipped last tab signals there is more to scroll.
    <nav
      aria-label="Copilot sections"
      className="no-scrollbar -mb-px overflow-x-auto border-b border-zinc-950/10 dark:border-white/10"
    >
      <div className="flex w-max min-w-full gap-6">
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
                'shrink-0 border-b-2 px-1 py-3 text-sm font-medium whitespace-nowrap transition-colors',
                'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-500',
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
    </nav>
  )
}
