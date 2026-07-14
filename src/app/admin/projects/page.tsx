import { CodeBracketIcon, CpuChipIcon } from '@heroicons/react/24/outline'
import { PlusIcon } from '@heroicons/react/16/solid'
import type { Metadata } from 'next'

import { AgentPageHeader } from '@/components/agent-ops/agent-page-header'
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

interface KpiBandProps {
  projectsCount: number
  validatedCount: number
  totalActive: number
  totalRuns: number
  totalCost: number
}

function KpiBand({ projectsCount, validatedCount, totalActive, totalRuns, totalCost }: KpiBandProps) {
  return (
    <div className="flex flex-wrap gap-x-12 gap-y-6 py-4 border-b border-white/5 mb-10">
      <div className="flex flex-col group cursor-default">
        <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-600 mb-1">Total Projects</span>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-light tracking-tight text-white">{projectsCount}</span>
        </div>
      </div>
      <div className="flex flex-col group cursor-default">
        <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-600 mb-1">Assigned Copilots</span>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-light tracking-tight text-white">{validatedCount}</span>
          <span className="text-xs text-zinc-600">/ {totalActive} active</span>
        </div>
      </div>
      <div className="flex flex-col group cursor-default">
        <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-600 mb-1">24h Project Volume</span>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-light tracking-tight text-white">{totalRuns.toLocaleString('en-US')}</span>
          <span className="text-xs text-zinc-600">runs</span>
        </div>
      </div>
      <div className="flex flex-col group cursor-default">
        <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-600 mb-1">24h Project Cost</span>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-light tracking-tight text-white">{formatUsd(totalCost)}</span>
        </div>
      </div>
    </div>
  )
}

export default async function ProjectsPage() {
  const [projects, copilots] = await Promise.all([getProjects(), getCopilots()])
  const rollups = rollupByProject(copilots)

  const validated = copilots.filter((copilot) => copilot.projectId !== null)
  const totalActive = validated.filter((copilot) => copilot.status === 'active').length
  const totalRuns = validated.reduce((sum, copilot) => sum + copilot.health.runsLast24h, 0)
  const totalCost = validated.reduce((sum, copilot) => sum + copilot.health.costLast24hUsd, 0)

  return (
    <div className="flex flex-col gap-4 pb-12">
      <StaggerFade delay={0}>
        <AgentPageHeader
          title="Projects"
          description="Product surfaces and repositories managed by the agent fleet."
          actions={
            <Link 
              href="/admin/projects/new" 
              className="inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-white/20 transition-colors"
            >
              <PlusIcon className="size-3.5" />
              New Project
            </Link>
          }
        />
      </StaggerFade>

      <StaggerFade delay={1}>
        <KpiBand 
          projectsCount={projects.length} 
          validatedCount={validated.length} 
          totalActive={totalActive} 
          totalRuns={totalRuns} 
          totalCost={totalCost} 
        />
      </StaggerFade>

      <StaggerFade delay={2}>
        {projects.length > 0 ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-6 py-2 border-b border-white/10 text-[10px] font-medium text-zinc-600 font-mono">
              <div className="w-[300px]">Project</div>
              <div className="w-[120px]">Status</div>
              <div className="w-[140px]">Fleet</div>
              <div className="w-[120px]">Volume</div>
              <div className="w-[120px]">Cost</div>
              <div className="ml-auto"></div>
            </div>
            <div className="flex flex-col gap-4">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  rollup={rollups.get(project.id) ?? EMPTY_ROLLUP}
                  href={`/admin/projects/${project.id}`}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-[13px] text-zinc-500">No projects yet.</p>
          </div>
        )}
      </StaggerFade>
    </div>
  )
}
