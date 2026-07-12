import type { Metadata } from 'next'

import { AgentPageHeader } from '@/components/agent-ops/agent-page-header'
import { NewProjectWorkbench } from '@/components/agent-ops/new-project-workbench'

export const metadata: Metadata = {
  title: 'Create a project',
}

export default function NewProjectPage() {
  return (
    <div className="space-y-8">
      <AgentPageHeader
        title="Create a project"
        description="Pick the GitHub repository this project lives in, preview its file tree, then register the project."
        className="mt-2"
      />

      <NewProjectWorkbench />
    </div>
  )
}
