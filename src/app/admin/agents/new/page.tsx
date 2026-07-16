import { ChevronLeftIcon } from '@heroicons/react/16/solid'
import clsx from 'clsx'
import type { Metadata } from 'next'

import { NewCopilotWorkbench } from '@/components/agent-ops/new-copilot-workbench'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { surfaceCardClass, surfaceCardHeaderClass } from '@/components/agent-ops/surface-card'
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
        <div className={clsx(surfaceCardClass, 'flex flex-col')}>
          <div className={clsx(surfaceCardHeaderClass, 'px-6 py-6 lg:px-8')}>
            <div className="min-w-0">
              <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-xs">
                <Link
                  href="/admin"
                  className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-white"
                >
                  <ChevronLeftIcon aria-hidden="true" className="size-3.5 shrink-0" />
                  Dashboard
                </Link>
              </nav>
              <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
                Create a copilot
              </h1>
              <p className="mt-2 text-sm text-zinc-400">
                Describe what you need and the architect assistant can draft a manifest for you, or
                fill in the form manually.
              </p>
            </div>
          </div>
        </div>
      </StaggerFade>

      <StaggerFade delay={1}>
        <NewCopilotWorkbench projects={projects} />
      </StaggerFade>
    </div>
  )
}
