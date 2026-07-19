import { ChevronLeftIcon } from '@heroicons/react/16/solid'
import type { Metadata } from 'next'

import { NewCopilotWorkbench } from '@/components/agent-ops/new-copilot-workbench'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { AdminPageHeader } from '@/components/agent-ops/surface-card'
import { Link } from '@/components/catalyst/link'
import { getProjects } from '@/lib/agent-mission-control/data'

export const metadata: Metadata = {
  title: 'Create a copilot',
}

export default async function NewCopilotPage() {
  const projects = await getProjects()

  return (
    <div className="flex flex-col gap-8 pb-12">
      <StaggerFade delay={0}>
        <nav aria-label="Breadcrumb" className="mb-2 flex min-w-0 items-center gap-2 text-xs">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1 text-zinc-500 hover:text-white"
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
    </div>
  )
}
