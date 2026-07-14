'use client'

import * as Headless from '@headlessui/react'
import { MagnifyingGlassIcon } from '@heroicons/react/16/solid'
import { useState } from 'react'
import clsx from 'clsx'

import { CopilotRegistryTable } from '@/components/agent-ops/copilot-registry-table'
import { Input, InputGroup } from '@/components/catalyst/input'
import type { Copilot, Project } from '@/lib/agent-mission-control/types'

export type RegistryTableView = 'bench' | 'all'

function ViewTab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
}) {
  return (
    <Headless.Button
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'rounded-md text-[13px] font-medium transition-colors focus:outline-hidden data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-accent-500',
        active ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
      )}
    >
      {label} <span className="ml-1 font-mono text-zinc-600">{count}</span>
    </Headless.Button>
  )
}

export function RegistryView({
  copilots,
  projects,
}: {
  copilots: Copilot[]
  projects: Project[]
}) {
  const [view, setView] = useState<RegistryTableView>('bench')
  const [searchQuery, setSearchQuery] = useState('')

  const benchCount = copilots.filter((copilot) => copilot.projectId === null).length

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <ViewTab
            active={view === 'bench'}
            onClick={() => setView('bench')}
            label="Validation Bench"
            count={benchCount}
          />
          <ViewTab
            active={view === 'all'}
            onClick={() => setView('all')}
            label="All Copilots"
            count={copilots.length}
          />
        </div>

        <div className="w-full sm:w-64">
          <InputGroup>
            <MagnifyingGlassIcon data-slot="icon" />
            <Input
              type="search"
              aria-label="Search copilots"
              placeholder="Search copilots…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </InputGroup>
        </div>
      </div>

      <CopilotRegistryTable copilots={copilots} projects={projects} view={view} searchQuery={searchQuery} />
    </div>
  )
}
