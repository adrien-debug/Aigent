import { CopilotRegistryTable } from '@/components/agent-ops/copilot-registry-table'
import type { Copilot, Project } from '@/lib/agent-mission-control/types'

/**
 * Registry main area: the full-width filterable table stacked above the
 * server-rendered warnings feed (injected via `warningsSlot`). No detail
 * preview panel — the copilot name deep-links to its overview.
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
  return (
    <div className="space-y-8">
      <CopilotRegistryTable copilots={copilots} projects={projects} />
      {warningsSlot}
    </div>
  )
}
