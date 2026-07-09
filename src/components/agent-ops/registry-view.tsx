'use client'

import { useState } from 'react'

import { CopilotDetailPanel } from '@/components/agent-ops/copilot-detail-panel'
import { CopilotRegistryTable } from '@/components/agent-ops/copilot-registry-table'
import type { Copilot, Project } from '@/lib/agent-mission-control/types'

/**
 * Client wrapper for the registry main area: holds the selected-copilot state
 * shared between the table (left) and the preview panel (right). The
 * server-rendered warnings card is injected via `warningsSlot`.
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
  const [selectedId, setSelectedId] = useState<string | null>(copilots[0]?.id ?? null)

  const selected: Copilot | undefined = copilots.find((copilot) => copilot.id === selectedId) ?? copilots[0]
  const selectedProject: Project | undefined = selected
    ? projects.find((project) => project.id === selected.projectId)
    : undefined

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
      <div className="min-w-0 lg:col-span-2">
        <CopilotRegistryTable
          copilots={copilots}
          projects={projects}
          selectedId={selected?.id ?? null}
          onSelect={(copilot) => setSelectedId(copilot.id)}
        />
      </div>
      <div className="min-w-0 space-y-6">
        {selected ? <CopilotDetailPanel copilot={selected} project={selectedProject} /> : null}
        {warningsSlot}
      </div>
    </div>
  )
}
