import { PlusIcon } from '@heroicons/react/16/solid'
import clsx from 'clsx'
import type { Metadata } from 'next'

import { ProjectCard } from '@/components/agent-ops/project-card'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { surfaceCardClass, surfaceCardHeaderClass } from '@/components/agent-ops/surface-card'
import { Button } from '@/components/catalyst/button'
import { getCopilots, getProjects } from '@/lib/agent-mission-control/data'
import type { Copilot } from '@/lib/agent-mission-control/types'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Projects — Aigent',
}

interface ProjectRollup {
  copilotCount: number
  activeCount: number
  runsLast24h: number
  costLast24hUsd: number
  openWarnings: number
}

const EMPTY_ROLLUP: ProjectRollup = {
  copilotCount: 0,
  activeCount: 0,
  runsLast24h: 0,
  costLast24hUsd: 0,
  openWarnings: 0,
}

function rollupByProject(copilots: Copilot[]): Map<string, ProjectRollup> {
  const byProject = new Map<string, ProjectRollup>()
  for (const copilot of copilots) {
    if (copilot.projectId === null) continue
    const current = byProject.get(copilot.projectId) ?? { ...EMPTY_ROLLUP }
    current.copilotCount += 1
    if (copilot.status === 'active') current.activeCount += 1
    current.runsLast24h += copilot.health.runsLast24h
    current.costLast24hUsd += copilot.health.costLast24hUsd
    current.openWarnings += copilot.health.openWarnings
    byProject.set(copilot.projectId, current)
  }
  return byProject
}

export default async function ProjectsPage() {
  const [projects, copilots] = await Promise.all([getProjects(), getCopilots()])
  const rollups = rollupByProject(copilots)

  return (
    <div className="flex flex-col gap-8 pb-12">
      <StaggerFade delay={0}>
        <div className={clsx(surfaceCardClass, 'flex min-h-[600px] flex-col')}>
          <div className={clsx(surfaceCardHeaderClass, 'px-6 py-6 lg:px-8')}>
            <div className="min-w-0">
              <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">Projects</h1>
              <p className="mt-2 text-sm text-zinc-400">
                Product surfaces you operate — copilots, 24h volume and cost roll up per project.
              </p>
            </div>
            <Button href="/admin/projects/new" color="accent" className="shrink-0">
              <PlusIcon />
              New Project
            </Button>
          </div>

          {projects.length > 0 ? (
            <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4 p-6">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  rollup={rollups.get(project.id) ?? EMPTY_ROLLUP}
                  href={`/admin/projects/${project.id}`}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm font-medium text-white">No projects yet</p>
              <p className="text-xs text-zinc-500">
                Register the first product surface to start assigning copilots.
              </p>
              <Button href="/admin/projects/new" color="accent" className="mt-2">
                <PlusIcon />
                New Project
              </Button>
            </div>
          )}
        </div>
      </StaggerFade>
    </div>
  )
}
