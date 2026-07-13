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
 * agent contextualized to it. The initial scan is NOT run server-side on load
 * (it costs a GitHub round-trip and the operator may not want it yet) — the
 * workbench exposes a "Scan repo" button.
 */
export default async function ProjectBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const project = await getProject(id)
  if (!project) notFound()

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mt-2 flex min-w-0 items-center gap-2 text-xs">
        <Link
          href={`/admin/projects/${id}`}
          className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-white"
        >
          <ChevronLeftIcon aria-hidden="true" className="size-3.5 shrink-0" />
          {project.name}
        </Link>
      </nav>

      <AgentPageHeader title="Agent Builder" description="Draft a repo-aware agent for this project." className="mt-3" />

      <div className="mt-6 lg:mt-8">
        <ProjectAgentBuilderWorkbench
          projectId={id}
          projectName={project.name}
          repoFullName={project.repoFullName ?? null}
          initialScan={null}
        />
      </div>
    </div>
  )
}
