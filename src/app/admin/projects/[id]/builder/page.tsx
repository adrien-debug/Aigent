import type { Metadata } from 'next'

import { ProjectBuilderScreen } from '@/components/console/project-builder-screen'
import { getProjectBuilderPageData } from '@/lib/agent-mission-control/project-builder-page-data'

export const metadata: Metadata = { title: 'Project Builder — Aigent' }

export default async function ProjectBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ seed?: string }>
}) {
  const { id } = await params
  const { seed } = await searchParams
  const data = await getProjectBuilderPageData(id, seed)
  return <ProjectBuilderScreen {...data} />
}
