import type { Metadata } from 'next'

import { ProjectsListView } from '@/components/views/projects/projects-list-view'
import { getDashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Projects — Aigent',
}

export default async function ProjectsPage() {
  const overview = await getDashboardOverview()
  return <ProjectsListView projects={overview.projects} />
}
