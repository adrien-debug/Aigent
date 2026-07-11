import { FolderIcon } from '@heroicons/react/24/outline'
import { PlusIcon } from '@heroicons/react/16/solid'
import type { Metadata } from 'next'

import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { AgentPageHeader } from '@/components/agent-ops/agent-page-header'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { ProjectCard } from '@/components/agent-ops/project-card'
import { SoftAccentLink } from '@/components/agent-ops/soft-accent-link'
import { getCopilots, getProjects } from '@/lib/agent-mission-control/data'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type { Copilot } from '@/lib/agent-mission-control/types'

export const metadata: Metadata = {
  title: 'Projects — Agent Mission Control',
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

/**
 * Aggregate copilot health per project — one pass over the registry.
 * `projectId: null` = bench copilot (not yet validated) → excluded from
 * per-project counts.
 */
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

  // Bench copilots (projectId null) are excluded — this page counts validated agents only.
  const validated = copilots.filter((copilot) => copilot.projectId !== null)
  const totalActive = validated.filter((copilot) => copilot.status === 'active').length
  const totalRuns = validated.reduce((sum, copilot) => sum + copilot.health.runsLast24h, 0)
  const totalCost = validated.reduce((sum, copilot) => sum + copilot.health.costLast24hUsd, 0)

  // Per-project series in a stable order — traffic/spend concentration at a glance.

  return (
    <div className="space-y-8">
      {/* Header uniforme sur les 5 pages /admin (directive Adrien 2026-07-11). */}
      <AgentPageHeader
        title="Projects"
        description="Product surfaces with validated agents."
        className="mt-2"
        actions={
          <SoftAccentLink href="/admin/projects/new">
            <PlusIcon aria-hidden="true" className="size-4" />
            New project
          </SoftAccentLink>
        }
      />

      <AgentKpiBand
        stats={[
          {
            name: 'Projects',
            value: String(projects.length),
          },
          {
            name: 'Copilots',
            value: String(validated.length),
            hint: `${totalActive} active · validated, excl. bench`,
          },
          {
            name: 'Runs 24h',
            value: totalRuns.toLocaleString('en-US'),
          },
          {
            name: 'Cost 24h',
            value: formatUsd(totalCost),
          },
        ]}
      />

      {projects.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-6">
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
        <AgentSectionCard title="Projects">
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <FolderIcon aria-hidden="true" className="size-8 text-zinc-400 dark:text-zinc-600" />
            <p className="text-sm font-medium text-zinc-950 dark:text-white">No projects yet</p>
            <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              Projects appear here as soon as a copilot is registered against a product surface.
            </p>
          </div>
        </AgentSectionCard>
      )}
    </div>
  )
}
