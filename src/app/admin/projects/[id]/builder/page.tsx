import { getProject } from '@/lib/agent-mission-control/data'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ProjectBuilderModal } from '@/components/agent-ops/project-builder-modal'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const project = await getProject(id)
  return { title: project ? `Agent Builder — ${project.name}` : 'Agent Builder — Agent Mission Control' }
}

/**
 * /admin/projects/[id]/builder — the repo-aware Agent Builder for a project,
 * rendered as a full-screen MODAL over the project overview.
 *
 * The builder scans the project's linked GitHub repo (read-only) and drafts an
 * agent contextualized to it. Repo intelligence is auto-scanned on the project
 * overview; here the workbench still exposes an explicit "Scan repo" action
 * (bottom bar) for the builder's own bounded summary. A `?seed=<title>` query
 * (from a "Discuss in builder" recommendation link) pre-fills the request box.
 * Nothing is created before the human approves the drafted spec.
 *
 * This route stays a real page (so links/back-nav/refresh keep working) but
 * its content is a Dialog overlay: closing it (Escape or the corner cross)
 * navigates back to `/admin/projects/[id]` — the project underneath, not a
 * blank page.
 */
export default async function ProjectBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ seed?: string }>
}) {
  const { id } = await params
  const { seed } = await searchParams
  const project = await getProject(id)
  if (!project) notFound()

  return (
    <ProjectBuilderModal
      projectId={id}
      projectName={project.name}
      repoFullName={project.repoFullName ?? null}
      seedInput={typeof seed === 'string' ? seed.slice(0, 200) : undefined}
    />
  )
}
