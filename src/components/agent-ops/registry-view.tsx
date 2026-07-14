'use client'

import { useState } from 'react'
import clsx from 'clsx'

import { CopilotRegistryTable } from '@/components/agent-ops/copilot-registry-table'
import type { Copilot, Project, RegistryWarning } from '@/lib/agent-mission-control/types'

export type RegistryTableView = 'bench' | 'all'

export function RegistryView({
  copilots,
  projects,
  warnings,
}: {
  copilots: Copilot[]
  projects: Project[]
  warnings: RegistryWarning[]
}) {
  const [view, setView] = useState<RegistryTableView>('bench')
  const [searchQuery, setSearchQuery] = useState('')

  const benchCount = copilots.filter((copilot) => copilot.projectId === null).length

  return (
    <div className="flex flex-col gap-8">
      {/* Toolbar - Ultra minimal */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-6 text-[13px]">
          <button
            onClick={() => setView('bench')}
            className={clsx(
              'font-medium transition-colors',
              view === 'bench' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
            )}
          >
            Validation Bench <span className="ml-1 text-zinc-600 font-mono">{benchCount}</span>
          </button>
          <button
            onClick={() => setView('all')}
            className={clsx(
              'font-medium transition-colors',
              view === 'all' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
            )}
          >
            All Copilots <span className="ml-1 text-zinc-600 font-mono">{copilots.length}</span>
          </button>
        </div>

        <div className="flex items-center">
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-48 bg-transparent border-b border-white/10 pb-1 text-[13px] text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
          />
        </div>
      </div>

      <CopilotRegistryTable 
        copilots={copilots} 
        projects={projects} 
        view={view} 
        searchQuery={searchQuery}
      />
    </div>
  )
}
