import type { Metadata } from 'next'

import { NewProjectWorkbench } from '@/components/agent-ops/new-project-workbench'
import { Heading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'

export const metadata: Metadata = {
  title: 'Create a project',
}

export default function NewProjectPage() {
  return (
    <div className="space-y-8">
      <div>
        <Heading>Create a project</Heading>
        <Text className="mt-2 max-w-2xl">
          Pick the GitHub repository this project lives in, preview its file tree, then register the project.
        </Text>
      </div>

      <NewProjectWorkbench />
    </div>
  )
}
