import type { Metadata } from 'next'

import { ProjectTeamView } from '@/components/views/projects/project-team-view'
import { getProject } from '@/lib/agent-mission-control/data'
import { getProjectTeamPageData } from '@/lib/agent-mission-control/project-team-page-data'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const project = await getProject(id)
  return { title: project ? `My Team — ${project.name} — Aigent` : 'My Team — Aigent' }
}

export default async function ProjectTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getProjectTeamPageData(id)
  return <ProjectTeamView {...data} />
}
