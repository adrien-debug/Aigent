import type { Metadata } from 'next'

import { ProjectDetailView } from '@/components/views/projects/project-detail-view'
import { getProject } from '@/lib/agent-mission-control/data'
import { getProjectDetailPageData } from '@/lib/agent-mission-control/project-detail-page-data'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const project = await getProject(id)
  return {
    title: project
      ? `${project.name} — Projects — Aigent`
      : 'Project — Aigent',
  }
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getProjectDetailPageData(id)
  return <ProjectDetailView {...data} />
}
