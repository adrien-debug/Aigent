import { ChevronLeftIcon } from '@heroicons/react/16/solid'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

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
    // Fill main's height and lay out as a column: fixed-height header rows, then
    // the workbench takes the REST (flex-1). Nothing here exceeds the screen, so
    // main never grows a second scrollbar behind the chat — the only scroll is
    // inside the chat/preview panes themselves.
    <div className="flex h-full min-h-0 flex-col">
      {/* One compact header line — breadcrumb + title + description inline —
          so the chat gets the vertical space, not the chrome. */}
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 text-xs">
        <Link
          href={`/admin/projects/${id}`}
          className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-white"
        >
          <ChevronLeftIcon aria-hidden="true" className="size-3.5 shrink-0" />
          {project.name}
        </Link>
        <span className="text-zinc-700">/</span>
        <h1 className="text-sm font-medium text-white">Agent Builder</h1>
        <span className="text-zinc-600">·</span>
        <span className="truncate text-zinc-500">
          Discuss repo-aware agent options — draft only after explicit approval.
        </span>
      </div>

      <div className="mt-4 min-h-0 flex-1 rounded-2xl bg-[var(--color-surface-primary)] p-3 lg:p-4">
        <ProjectAgentBuilderWorkbench
          projectId={id}
          projectName={project.name}
          repoFullName={project.repoFullName ?? null}
          initialScan={null}
          seedInput={typeof seed === 'string' ? seed.slice(0, 200) : undefined}
        />
      </div>
    </div>
  )
}
