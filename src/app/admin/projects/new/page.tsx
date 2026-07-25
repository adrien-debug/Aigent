import type { Metadata } from 'next'

import { ProjectNewView } from '@/components/views/projects/project-new-view'

export const metadata: Metadata = {
  title: 'Create a project',
}

export default function NewProjectPage() {
  return <ProjectNewView />
}
