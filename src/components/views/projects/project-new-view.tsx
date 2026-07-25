import { NewProjectWorkbench } from '@/components/agent-ops/new-project-workbench'
import { PageHeader } from '@/components/shell/page-header'
import { PageLayout } from '@/components/shell/page-layout'

export function ProjectNewView() {
  return (
    <PageLayout>
      <PageHeader
        title="Create a project"
        description="Pick the GitHub repository this project lives in, preview its file tree, then register the project."
      />

      <NewProjectWorkbench />
    </PageLayout>
  )
}
