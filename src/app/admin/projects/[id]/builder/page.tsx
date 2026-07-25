import type { Metadata } from 'next'

import { ProjectBuilderView } from '@/components/views/projects/project-builder-view'
import { getProject } from '@/lib/agent-mission-control/data'
import { getProjectBuilderPageData } from '@/lib/agent-mission-control/project-builder-page-data'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const project = await getProject(id)
  return { title: project ? `Agent Builder — ${project.name}` : 'Agent Builder — Agent Mission Control' }
}

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ seed?: string }> }

export default async function ProjectBuilderPage({ params, searchParams }: Props) {
  const { id } = await params
  const { seed } = await searchParams
  const data = await getProjectBuilderPageData(id, seed)
  return <ProjectBuilderView {...data} />
}
