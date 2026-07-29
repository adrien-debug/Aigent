import type { Metadata } from 'next'

import { ProjectsScreen } from '@/components/console/projects-screen'
import { getCopilots, getProjects } from '@/lib/agent-mission-control/data'

export const metadata: Metadata = { title: 'Projects — Aigent' }

export default async function ProjectsPage() {
  const [projects, copilots] = await Promise.all([getProjects(), getCopilots({ health: 'list' })])
  return <ProjectsScreen projects={projects} copilots={copilots} />
}
