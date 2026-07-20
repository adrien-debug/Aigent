import type { Metadata } from 'next'

import { NewProjectWorkbench } from '@/components/agent-ops/new-project-workbench'
import { AdminPageHeader } from '@/components/agent-ops/surface-card'

export const metadata: Metadata = {
  title: 'Create a project',
}

export default function NewProjectPage() {
  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Create a project"
        description="Pick the GitHub repository this project lives in, preview its file tree, then register the project."
      />

      <NewProjectWorkbench />
    </div>
  )
}
