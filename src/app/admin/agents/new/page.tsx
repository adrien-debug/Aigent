import type { Metadata } from 'next'

import { AgentPageHeader } from '@/components/agent-ops/agent-page-header'
import { NewCopilotWorkbench } from '@/components/agent-ops/new-copilot-workbench'
import { getProjects } from '@/lib/agent-mission-control/data'

export const metadata: Metadata = {
  title: 'Create a copilot',
}

export default async function NewCopilotPage() {
  const projects = await getProjects()

  return (
    <div className="space-y-8">
      <AgentPageHeader
        title="Create a copilot"
        description="Describe what you need and the architect assistant can draft a manifest for you, or fill in the form manually below."
        className="mt-2"
      />

      <NewCopilotWorkbench projects={projects} />
    </div>
  )
}
