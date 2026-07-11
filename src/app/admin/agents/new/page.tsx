import type { Metadata } from 'next'

import { NewCopilotWorkbench } from '@/components/agent-ops/new-copilot-workbench'
import { Heading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'
import { getProjects } from '@/lib/agent-mission-control/data'

export const metadata: Metadata = {
  title: 'Create a copilot',
}

export default async function NewCopilotPage() {
  const projects = await getProjects()

  return (
    <div className="space-y-8">
      <div>
        <Heading>Create a copilot</Heading>
        <Text className="mt-2 max-w-2xl">
          Describe what you need and the architect assistant can draft a manifest for you, or fill in the form
          manually below.
        </Text>
      </div>

      <NewCopilotWorkbench projects={projects} />
    </div>
  )
}
