import type { Metadata } from 'next'

import { AgentNewView } from '@/components/views/agents/agent-new-view'
import { getProjects } from '@/lib/agent-mission-control/data'

export const metadata: Metadata = {
  title: 'Create a copilot',
}

export default async function NewCopilotPage() {
  const projects = await getProjects()
  return <AgentNewView projects={projects} />
}
