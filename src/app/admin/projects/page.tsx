import { PlusIcon } from '@heroicons/react/16/solid'
import type { Metadata } from 'next'

import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { ProjectCard } from '@/components/agent-ops/project-card'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { getCopilots, getProjects } from '@/lib/agent-mission-control/data'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type { Copilot } from '@/lib/agent-mission-control/types'
import { Link } from '@/components/catalyst/link'

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

  const validated = copilots.filter((copilot) => copilot.projectId !== null)
  const totalActive = validated.filter((copilot) => copilot.status === 'active').length
  const totalRuns = validated.reduce((sum, copilot) => sum + copilot.health.runsLast24h, 0)
  const totalCost = validated.reduce((sum, copilot) => sum + copilot.health.costLast24hUsd, 0)

  return (
    <div className="flex flex-col gap-8 pb-12">
      <StaggerFade delay={0}>
        <div className="flex justify-end">
          <Link
            href="/admin/projects/new"
            className="inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-white/20 transition-colors"
          >
            <PlusIcon className="size-3.5" />
            New Project
          </Link>
        </div>
      </StaggerFade>

      <StaggerFade delay={1}>
        <AgentKpiBand
          stats={[
            { name: 'Total Projects', value: String(projects.length) },
            { name: 'Assigned Copilots', value: String(validated.length), suffix: `/ ${totalActive} active` },
            { name: '24h Project Volume', value: totalRuns.toLocaleString('en-US'), suffix: 'runs' },
            { name: '24h Project Cost', value: formatUsd(totalCost) },
          ]}
        />
      </StaggerFade>

      <StaggerFade delay={2}>
        {projects.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
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
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/5 bg-white/[0.01] py-24 text-center">
            <p className="text-sm font-medium text-white">No projects yet</p>
            <p className="text-xs text-zinc-500">
              Register the first product surface to start assigning copilots.
            </p>
            <Link
              href="/admin/projects/new"
              className="mt-2 inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-white/20"
            >
              <PlusIcon className="size-3.5" />
              New Project
            </Link>
          </div>
        )}
      </StaggerFade>
    </div>
  )
}
