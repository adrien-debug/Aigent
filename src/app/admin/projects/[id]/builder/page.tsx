import type { Metadata } from 'next'

import { ConsoleShell } from '@/components/console/console-shell'
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

  // No `stateLabel` / `degraded`: the builder's only health signal is its SSE
  // lifecycle, which lives in client state the server layout cannot read. The
  // screen renders that state itself, next to its own header — a topbar dot here
  // would be a claim the route cannot back. `/admin/projects/[id]/builder`
  // lights the Projects rail entry by prefix.
  return (
    <ConsoleShell activeHref={`/admin/projects/${id}/builder`} title="Project Builder">
      <ProjectBuilderScreen {...data} />
    </ConsoleShell>
  )
}
