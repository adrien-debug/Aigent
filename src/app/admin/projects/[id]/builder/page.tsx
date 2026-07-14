import { ChevronLeftIcon } from '@heroicons/react/16/solid'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { AgentPageHeader } from '@/components/agent-ops/agent-page-header'
import { ProjectAgentBuilderWorkbench } from '@/components/agent-ops/project-agent-builder-workbench'
import { Link } from '@/components/catalyst/link'
import { getProject } from '@/lib/agent-mission-control/data'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const project = await getProject(id)
  return { title: project ? `Agent Builder — ${project.name}` : 'Agent Builder — Agent Mission Control' }
}

/**
 * /admin/projects/[id]/builder — the repo-aware Agent Builder for a project.
 *
 * The builder scans the project's linked GitHub repo (read-only) and drafts an
 * agent contextualized to it. Repo intelligence is auto-scanned on the project
 * overview; here the workbench still exposes an explicit "Scan repo" button for
 * the builder's own bounded summary. A `?seed=<title>` query (from a "Discuss in
 * builder" recommendation link) pre-fills the request box. Nothing is created
 * before the human approves the drafted spec.
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
    <div className="relative">
      <div className="relative">
        <nav aria-label="Breadcrumb" className="mt-2 flex min-w-0 items-center gap-2 text-xs">
          <Link
            href={`/admin/projects/${id}`}
            className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-white"
          >
            <ChevronLeftIcon aria-hidden="true" className="size-3.5 shrink-0" />
            {project.name}
          </Link>
        </nav>

        <AgentPageHeader
          title="Agent Builder"
          description="Discuss repo-aware agent options with the architect — prepare a draft only after explicit approval."
          className="mt-3"
        />

        <div className="mt-6 rounded-2xl bg-[var(--color-surface-primary)] p-4 lg:mt-8 lg:p-6">
          <ProjectAgentBuilderWorkbench
            projectId={id}
            projectName={project.name}
            repoFullName={project.repoFullName ?? null}
            initialScan={null}
            seedInput={typeof seed === 'string' ? seed.slice(0, 200) : undefined}
          />
        </div>
      </div>
    </div>
  )
}
