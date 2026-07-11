'use client'

import { PlusIcon } from '@heroicons/react/16/solid'
import clsx from 'clsx'
import Link from 'next/link'
import { useState } from 'react'

import { CopilotRegistryTable, type RegistryTableView } from '@/components/agent-ops/copilot-registry-table'
import type { Copilot, Project } from '@/lib/agent-mission-control/types'

/**
 * Registry main area. The registry IS the validation bench: the default view
 * shows unassigned copilots (projectId === null, being tested/tuned) and a
 * segmented toggle switches to the full fleet. The server-rendered warnings
 * feed is injected via `warningsSlot`.
 */
export function RegistryView({
  copilots,
  projects,
  warningsSlot,
}: {
  copilots: Copilot[]
  projects: Project[]
  warningsSlot?: React.ReactNode
}) {
  const [view, setView] = useState<RegistryTableView>('bench')
  const benchCount = copilots.filter((copilot) => copilot.projectId === null).length

  const options: { value: RegistryTableView; label: string }[] = [
    { value: 'bench', label: `Validation bench (${benchCount})` },
    { value: 'all', label: `All copilots (${copilots.length})` },
  ]

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div
            role="group"
            aria-label="Registry view"
            className="inline-flex rounded-lg bg-zinc-950/5 p-1 dark:bg-white/5"
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={view === option.value}
                onClick={() => setView(option.value)}
                className={clsx(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500',
                  view === option.value
                    ? 'bg-white text-zinc-950 shadow-sm ring-1 ring-zinc-950/10 dark:bg-zinc-950 dark:text-white dark:ring-white/10'
                    : 'text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          {/* Softened "New copilot" — veiled pastel accent (same tone as the
              active nav item) instead of the solid accent-700 button. */}
          <Link
            href="/admin/agents/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-500/10 px-3 py-1.5 text-sm font-medium text-accent-700 ring-1 ring-accent-500/20 transition-colors hover:bg-accent-500/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 dark:text-accent-300"
          >
            <PlusIcon aria-hidden="true" className="size-4" />
            New copilot
          </Link>
        </div>
        <CopilotRegistryTable copilots={copilots} projects={projects} view={view} />
      </div>
      {warningsSlot}
    </div>
  )
}
