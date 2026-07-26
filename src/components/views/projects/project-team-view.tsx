import { ServerStackIcon } from '@heroicons/react/24/outline'

import { ProjectTabs } from '@/components/agent-ops/project-tabs'
import { ProjectTeamView as ProjectTeamGraphView } from '@/components/agent-ops/project-team/project-team-view'
import { PageLayout } from '@/components/shell/page-layout'
import { Avatar } from '@/components/ui/avatar'
import { Heading } from '@/components/ui/heading'
import { PROJECT_PLATFORM_LABELS } from '@/lib/agent-mission-control/labels'
import type { ProjectTeamPageData } from '@/lib/agent-mission-control/project-team-page-data'

/**
 * `/admin/projects/:id/team` — the project's agent team as a graph.
 *
 * Deliberately NOT wrapped in a `mx-auto max-w-*` container: the canvas is the
 * dominant surface of this screen and a centred column would waste exactly the
 * horizontal room the graph needs. The admin shell already provides the page
 * gutters (agent-control-shell.tsx, `p-6 lg:p-8`).
 *
 * The heavy graph logic (canvas, filters, relation dialogs, polling) lives
 * unchanged in `agent-ops/project-team/project-team-view.tsx` — this view is
 * only the coquille that poses `PageLayout` + the identity strip + tabs
 * around it.
 */
export function ProjectTeamView({ project, graph, loadError }: ProjectTeamPageData) {
  return (
    <PageLayout className="flex min-h-0 flex-1 flex-col gap-4 pb-0">
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
        <Heading className="truncate tracking-tight">{project.name}</Heading>
        {/* zinc-400, not -500: check-contrast measures -500 at 3.90:1 against
            this page's sunken canvas (rgb(17,17,20)) for a 4.5 threshold. */}
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-zinc-400">
          <ServerStackIcon aria-hidden="true" className="size-4" />
          <span className="font-mono">{PROJECT_PLATFORM_LABELS[project.platform]}</span>
        </span>
      </div>

      <ProjectTabs projectId={project.id} />

      <ProjectTeamGraphView projectId={project.id} initialGraph={graph} loadError={loadError} />
    </PageLayout>
  )
}
