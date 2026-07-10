import { FolderIcon } from '@heroicons/react/24/outline'
import type { Metadata } from 'next'

import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { Badge } from '@/components/catalyst/badge'
import { Link } from '@/components/catalyst/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { getCopilots, getProjects } from '@/lib/agent-mission-control/data'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type { Copilot, Project } from '@/lib/agent-mission-control/types'

export const metadata: Metadata = {
  title: 'Projects — Agent Mission Control',
}

const PLATFORM_LABELS: Record<Project['platform'], string> = {
  web: 'Web',
  desktop: 'Desktop',
  mobile: 'Mobile',
  api: 'API',
}

const numberFormat = new Intl.NumberFormat('en-US')

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
  const totalRuns = validated.reduce((sum, copilot) => sum + copilot.health.runsLast24h, 0)
  const totalCost = validated.reduce((sum, copilot) => sum + copilot.health.costLast24hUsd, 0)

  return (
    <div className="space-y-8">
      {/* KPI en haut, marge au-dessus = petit header (directive Adrien 2026-07-10) */}
      <AgentKpiBand
        className="mt-2"
        stats={[
          { name: 'Projects', value: String(projects.length) },
          { name: 'Copilots', value: String(validated.length), hint: 'validated — excl. bench' },
          { name: 'Runs 24h', value: totalRuns.toLocaleString('en-US') },
          { name: 'Cost 24h', value: formatUsd(totalCost) },
        ]}
      />

      <AgentSectionCard
        title="Projects"
        description="Every product surface a copilot ships on — copilot fleet, traffic and spend per project."
        contentClassName="p-0"
      >
        {projects.length > 0 ? (
          <div className="px-6 [--gutter:--spacing(6)]">
            <Table bleed>
              {/* Accessible name must land on the <table> itself — Catalyst spreads props on its scroll wrapper. */}
              <caption className="sr-only">Projects</caption>
              <TableHead>
                <TableRow>
                  <TableHeader>Project</TableHeader>
                  <TableHeader>Platform</TableHeader>
                  <TableHeader className="text-right">Copilots</TableHeader>
                  <TableHeader className="text-right">Active</TableHeader>
                  <TableHeader className="text-right">Runs 24h</TableHeader>
                  <TableHeader className="text-right">Cost 24h</TableHeader>
                  <TableHeader className="text-right">Warnings</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {projects.map((project) => {
                  const rollup = rollups.get(project.id) ?? EMPTY_ROLLUP
                  return (
                    <TableRow key={project.id}>
                      <TableCell>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-zinc-950 dark:text-white">
                            <Link
                              href={`/admin/projects/${project.id}`}
                              title={project.name}
                              className="hover:underline"
                            >
                              {project.name}
                            </Link>
                          </div>
                          <div className="mt-1 truncate font-mono text-xs text-zinc-500">{project.slug}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge color="zinc">{PLATFORM_LABELS[project.platform]}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-zinc-700 tabular-nums dark:text-zinc-300">
                        {numberFormat.format(rollup.copilotCount)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-zinc-700 tabular-nums dark:text-zinc-300">
                        {numberFormat.format(rollup.activeCount)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-zinc-700 tabular-nums dark:text-zinc-300">
                        {numberFormat.format(rollup.runsLast24h)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {rollup.runsLast24h > 0 ? (
                          <span className="text-zinc-700 dark:text-zinc-300">
                            {formatUsd(rollup.costLast24hUsd)}
                          </span>
                        ) : (
                          <span className="text-zinc-500">
                            <span aria-hidden="true">&mdash;</span>
                            <span className="sr-only">No runs in the last 24 hours</span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {rollup.openWarnings > 0 ? (
                          <span className="inline-flex items-baseline gap-1.5 font-medium text-accent-600 dark:text-accent-400">
                            <span
                              aria-hidden="true"
                              className="size-1.5 shrink-0 self-center rounded-full bg-accent-500 dark:bg-accent-400"
                            />
                            <span className="font-mono tabular-nums">{numberFormat.format(rollup.openWarnings)}</span>
                            <span className="sr-only"> open warnings</span>
                          </span>
                        ) : (
                          <span className="font-mono text-zinc-500 tabular-nums">0</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <FolderIcon aria-hidden="true" className="size-8 text-zinc-400 dark:text-zinc-600" />
            <p className="text-sm font-medium text-zinc-950 dark:text-white">No projects yet</p>
            <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              Projects appear here as soon as a copilot is registered against a product surface.
            </p>
          </div>
        )}
      </AgentSectionCard>
    </div>
  )
}
