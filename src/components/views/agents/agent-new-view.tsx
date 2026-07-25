import { ChevronLeftIcon } from '@heroicons/react/16/solid'

import { NewCopilotWorkbench } from '@/components/agent-ops/new-copilot-workbench'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { AdminPageHeader } from '@/components/agent-ops/surface-card'
import { PageLayout } from '@/components/shell/page-layout'
import { Link } from '@/components/ui/link'
import type { getProjects } from '@/lib/agent-mission-control/data'

export function AgentNewView({ projects }: { projects: Awaited<ReturnType<typeof getProjects>> }) {
  return (
    <PageLayout className="gap-8 pb-12">
      <StaggerFade delay={0}>
        <nav aria-label="Breadcrumb" className="mb-2 flex min-w-0 items-center gap-2 text-xs">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-950 dark:hover:text-white"
          >
            <ChevronLeftIcon aria-hidden="true" className="size-3.5 shrink-0" />
            Dashboard
          </Link>
        </nav>
        <AdminPageHeader
          title="Create a copilot"
          description="Describe what you need and the architect assistant can draft a manifest for you, or fill in the form manually."
        />
      </StaggerFade>

      <StaggerFade delay={1}>
        <NewCopilotWorkbench projects={projects} />
      </StaggerFade>
    </PageLayout>
  )
}
