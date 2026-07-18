import { ServerStackIcon } from '@heroicons/react/24/outline'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ProjectTabs } from '@/components/agent-ops/project-tabs'
import { ProjectTeamView } from '@/components/agent-ops/project-team/project-team-view'
import { Avatar } from '@/components/catalyst/avatar'
import { getProject } from '@/lib/agent-mission-control/data'
import { PROJECT_PLATFORM_LABELS } from '@/lib/agent-mission-control/labels'
import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'
import { getProjectTeamGraph } from '@/lib/agent-mission-control/project-team/data'
import type { ProjectTeamGraph } from '@/lib/agent-mission-control/project-team/types'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const project = await getProject(id)
  return { title: project ? `My Team — ${project.name} — Aigent` : 'My Team — Aigent' }
}

/**
 * /admin/projects/:id/team — the project's agent team as a graph.
 *
 * Deliberately NOT wrapped in a `mx-auto max-w-*` container: the canvas is the
 * dominant surface of this screen and a centred column would waste exactly the
 * horizontal room the graph needs. The admin shell already provides the page
 * gutters (agent-control-shell.tsx, `p-6 lg:p-8`).
 *
 * Fail-closed: the graph is loaded and contract-validated server-side. If the
 * backend cannot answer, the client shell renders an explicit UNAVAILABLE state
 * with the operator-facing reason — never a locally reconstructed graph.
 */
export default async function ProjectTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const project = await getProject(id)
  if (!project) notFound()

  let graph: ProjectTeamGraph | null = null
  let loadError: string | null = null
  try {
    graph = (await getProjectTeamGraph(id)) ?? null
    if (!graph) notFound()
  } catch (err) {
    // Detail stays server-side; the operator gets a precise but non-leaking
    // reason so they know whether to retry or to page someone.
    console.error('[admin/projects/team] graph load failed:', err)
    loadError = isPgrestTimeout(err)
      ? 'The data backend did not answer in time (gateway timeout). The team graph could not be built. Retry in a moment; if it persists, check the PostgREST service on gpu1.'
      : 'The data backend is unreachable, so this project’s team graph could not be built. No graph is shown rather than an approximate one. Check the agent-ops backend, then refresh.'
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Identity is deliberately ONE line: the canvas is the product on this
          screen, and a full ProjectHeader banner would spend ~200px of viewport
          restating what the tab row already says. Avatar + name + platform is
          enough to answer "where am I". */}
      <div className="flex min-w-0 items-center gap-3">
        <Avatar
          square
          src={project.logoUrl}
          initials={project.logoUrl ? undefined : project.name.slice(0, 2)}
          alt=""
          className="size-9 shrink-0 bg-zinc-900 text-white ring-1 ring-white/10"
        />
        <h1 className="truncate text-lg font-semibold tracking-tight text-white">{project.name}</h1>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-zinc-500">
          <ServerStackIcon aria-hidden="true" className="size-4" />
          <span className="font-mono">{PROJECT_PLATFORM_LABELS[project.platform]}</span>
        </span>
      </div>

      <ProjectTabs projectId={project.id} />

      <ProjectTeamView projectId={project.id} initialGraph={graph} loadError={loadError} />
    </div>
  )
}
