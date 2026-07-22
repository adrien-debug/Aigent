'use client'

import clsx from 'clsx'
import { usePathname } from 'next/navigation'
import { Link } from '@/components/catalyst/link'

/**
 * The canonical agent sections (AIGENT-AGENT-PAGES-021).
 *
 * Replaces the legacy Overview/Manifest/Quality/Runs/Improve/Release row, which
 * was organised around the engineering lifecycle rather than around operating
 * an agent. Manifest split into Configuration + Instructions; Quality, Improve,
 * Tests and Release collapsed into Observability.
 */
const SECTIONS = [
  { label: 'Overview', segment: '' },
  { label: 'Runs', segment: 'runs' },
  { label: 'Tools', segment: 'tools' },
  { label: 'Configuration', segment: 'configuration' },
  { label: 'Instructions', segment: 'instructions' },
  { label: 'Observability', segment: 'observability' },
] as const

export function AgentDetailNav({ copilotId }: { copilotId: string }) {
  const pathname = usePathname()
  const base = `/admin/agents/${copilotId}`

  return (
    // The hairline spans the full width even when the row is narrower than the
    // viewport, so it sits on the nav; the scroll track carries only the links.
    // On mobile the track scrolls horizontally inside this bounded box — the
    // page body never does.
    <nav
      aria-label="Agent sections"
      className="no-scrollbar -mb-px overflow-x-auto border-b border-zinc-950/10 dark:border-white/10"
    >
      <div className="flex w-max min-w-full gap-6">
        {SECTIONS.map(({ label, segment }) => {
          const href = segment ? `${base}/${segment}` : base
          const current = segment ? pathname === href || pathname.startsWith(`${href}/`) : pathname === base
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
