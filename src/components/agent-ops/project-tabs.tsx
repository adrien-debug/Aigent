'use client'

import clsx from 'clsx'
import { usePathname } from 'next/navigation'
import { Link } from '@/components/catalyst/link'

/**
 * Project sub-nav — same grammar as CopilotTabs (copilot-tabs.tsx): hairline
 * underline on the nav, accent underline + `aria-current` on the active tab,
 * horizontal scroll INSIDE the bounded track (never the page body).
 *
 * Only routes that ACTUALLY EXIST are listed — a tab pointing at a missing
 * segment is a 404 generator, not a roadmap. Today the project surface has
 * exactly three: the overview (`page.tsx`), the Agent Builder (`builder/`) and
 * My Team (`team/`). "My Team" sits next to Agent Builder because both are
 * agent-facing surfaces: you assemble agents in the builder, you read the
 * assembled team in the graph.
 */
const TABS = [
  { label: 'Overview', segment: '' },
  { label: 'Agent Builder', segment: 'builder' },
  { label: 'My Team', segment: 'team' },
] as const

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname()
  const base = `/admin/projects/${projectId}`

  return (
    <nav
      aria-label="Project sections"
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
